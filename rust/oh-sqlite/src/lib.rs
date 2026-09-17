//! Read-only SQLite snapshot isolation.
//!
//! Copies a SQLite database plus its `-wal` and `-journal` sidecar files into
//! a private temporary directory, verifies ownership and permissions, checks
//! the SQLite magic header, and returns the isolated paths for a read-only
//! consumer. The consumer is responsible for opening the database with its own
//! SQLite library and never writes to the original files.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read, Write as _};
use std::path::{Path, PathBuf};

const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";
const SQLITE_MAGIC_LEN: usize = 16;

/// Options controlling snapshot creation.
#[derive(Debug, Clone, Deserialize)]
pub struct SnapshotOptions {
    /// Path to the main SQLite database file.
    pub source_path: PathBuf,
    /// Directory where the snapshot files will be written.
    pub output_directory: PathBuf,
    /// Maximum size in bytes for any individual file.
    #[serde(default = "default_max_file_bytes")]
    pub max_file_bytes: u64,
    /// Maximum total size in bytes across main + sidecars.
    #[serde(default = "default_max_total_bytes")]
    pub max_total_bytes: u64,
}

fn default_max_file_bytes() -> u64 { 16 * 1024 * 1024 * 1024 }
fn default_max_total_bytes() -> u64 { 64 * 1024 * 1024 * 1024 }

/// A successfully created snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    /// Path to the copied main database file.
    pub database_path: PathBuf,
    /// Path to the copied WAL file, if present.
    pub wal_path: Option<PathBuf>,
    /// Path to the copied journal file, if present.
    pub journal_path: Option<PathBuf>,
    /// Total bytes copied across all files.
    pub total_bytes: u64,
}

/// Errors returned by snapshot creation.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum SnapshotError {
    IoError { message: String },
    NotAFile { path: String },
    OwnershipError { path: String, reason: String },
    PermissionError { path: String, reason: String },
    SizeLimitExceeded { path: String, limit: u64 },
    InvalidSqliteHeader { path: String },
}

impl std::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for SnapshotError {}

impl From<io::Error> for SnapshotError {
    fn from(error: io::Error) -> Self {
        SnapshotError::IoError { message: error.to_string() }
    }
}

#[derive(Debug, Clone, Copy)]
struct FileCheck {
    uid: u32,
    mode: u32,
    size: u64,
}

#[cfg(unix)]
fn inspect_file(path: &Path) -> Result<FileCheck, SnapshotError> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::metadata(path)?;
    Ok(FileCheck {
        uid: meta.uid(),
        mode: meta.mode(),
        size: meta.len(),
    })
}

#[cfg(not(unix))]
fn inspect_file(path: &Path) -> Result<FileCheck, SnapshotError> {
    let meta = fs::metadata(path)?;
    Ok(FileCheck {
        uid: 0,
        mode: 0,
        size: meta.len(),
    })
}

#[cfg(unix)]
fn current_uid() -> u32 {
    unsafe { libc::getuid() }
}

#[cfg(not(unix))]
fn current_uid() -> u32 {
    0
}

fn check_owner(path: &Path, check: FileCheck) -> Result<(), SnapshotError> {
    let path_str = path.display().to_string();
    if check.uid != current_uid() {
        return Err(SnapshotError::OwnershipError {
            path: path_str,
            reason: format!("expected uid {}, got {}", current_uid(), check.uid),
        });
    }
    // Owner must have read permission; group/other must not have write.
    const OWNER_READ: u32 = 0o400;
    const GROUP_WRITE: u32 = 0o020;
    const OTHER_WRITE: u32 = 0o002;
    if check.mode & OWNER_READ == 0 {
        return Err(SnapshotError::PermissionError {
            path: path_str,
            reason: "owner read bit not set".to_string(),
        });
    }
    if check.mode & (GROUP_WRITE | OTHER_WRITE) != 0 {
        return Err(SnapshotError::PermissionError {
            path: path_str,
            reason: "group/other write bits must be clear".to_string(),
        });
    }
    Ok(())
}

fn copy_file_limited(
    source: &Path,
    destination: &Path,
    max_bytes: u64,
) -> Result<u64, SnapshotError> {
    let check = inspect_file(source)?;
    if check.size > max_bytes {
        return Err(SnapshotError::SizeLimitExceeded {
            path: source.display().to_string(),
            limit: max_bytes,
        });
    }

    let mut reader = fs::File::open(source)?;
    let mut writer = fs::File::create(destination)?;
    let mut copied: u64 = 0;
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buffer[..n])?;
        copied += n as u64;
        if copied > check.size {
            return Err(SnapshotError::InvalidSqliteHeader {
                path: source.display().to_string(),
            });
        }
    }

    // Sync the copy so WAL/journal are durably on disk before the consumer opens them.
    writer.sync_all()?;
    Ok(copied)
}

fn verify_sqlite_header(path: &Path) -> Result<(), SnapshotError> {
    let mut file = fs::File::open(path)?;
    let mut header = [0u8; SQLITE_MAGIC_LEN];
    match file.read_exact(&mut header) {
        Ok(()) => {}
        Err(_) => {
            return Err(SnapshotError::InvalidSqliteHeader {
                path: path.display().to_string(),
            });
        }
    }
    if header.as_slice() != SQLITE_MAGIC {
        return Err(SnapshotError::InvalidSqliteHeader {
            path: path.display().to_string(),
        });
    }
    Ok(())
}

/// Snapshot a SQLite database and its WAL/journal sidecars into a private
/// output directory. The original files are never modified.
pub fn snapshot_database(options: SnapshotOptions) -> Result<Snapshot, SnapshotError> {
    fs::create_dir_all(&options.output_directory)?;

    if !options.source_path.is_file() {
        return Err(SnapshotError::NotAFile {
            path: options.source_path.display().to_string(),
        });
    }

    let main_check = inspect_file(&options.source_path)?;
    check_owner(&options.source_path, main_check)?;

    let base_name = options
        .source_path
        .file_name()
        .ok_or_else(|| SnapshotError::IoError {
            message: "source path has no file name".to_string(),
        })?;

    let dest_path = options.output_directory.join(base_name);
    let mut total_bytes = copy_file_limited(&options.source_path, &dest_path, options.max_file_bytes)?;
    verify_sqlite_header(&dest_path)?;

    let source_dir = options.source_path.parent().unwrap_or(Path::new("."));
    let source_name = options
        .source_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let wal_source = source_dir.join(format!("{source_name}-wal"));
    let journal_source = source_dir.join(format!("{source_name}-journal"));

    let mut wal_path = None;
    if wal_source.is_file() {
        let check = inspect_file(&wal_source)?;
        check_owner(&wal_source, check)?;
        let dest = options.output_directory.join(format!("{source_name}-wal"));
        let bytes = copy_file_limited(&wal_source, &dest, options.max_file_bytes)?;
        total_bytes += bytes;
        wal_path = Some(dest);
    }

    let mut journal_path = None;
    if journal_source.is_file() {
        let check = inspect_file(&journal_source)?;
        check_owner(&journal_source, check)?;
        let dest = options.output_directory.join(format!("{source_name}-journal"));
        let bytes = copy_file_limited(&journal_source, &dest, options.max_file_bytes)?;
        total_bytes += bytes;
        journal_path = Some(dest);
    }

    if total_bytes > options.max_total_bytes {
        return Err(SnapshotError::SizeLimitExceeded {
            path: options.source_path.display().to_string(),
            limit: options.max_total_bytes,
        });
    }

    Ok(Snapshot {
        database_path: dest_path,
        wal_path,
        journal_path,
        total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_sqlite_header(path: &Path) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(SQLITE_MAGIC).unwrap();
        file.write_all(&[0u8; 512 - SQLITE_MAGIC_LEN]).unwrap();
    }

    #[test]
    fn snapshots_valid_database() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("chat.db");
        write_sqlite_header(&source);

        let out = temp.path().join("out");
        let snapshot = snapshot_database(SnapshotOptions {
            source_path: source,
            output_directory: out.clone(),
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 1024 * 1024,
        }).unwrap();

        assert!(snapshot.database_path.exists());
        assert_eq!(snapshot.wal_path, None);
        assert_eq!(snapshot.journal_path, None);
    }

    #[test]
    fn rejects_invalid_header() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("chat.db");
        fs::write(&source, b"not sqlite").unwrap();

        let result = snapshot_database(SnapshotOptions {
            source_path: source,
            output_directory: temp.path().join("out"),
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 1024 * 1024,
        });

        assert!(matches!(result, Err(SnapshotError::InvalidSqliteHeader { .. })));
    }

    #[test]
    fn rejects_missing_file() {
        let temp = tempfile::tempdir().unwrap();
        let result = snapshot_database(SnapshotOptions {
            source_path: temp.path().join("missing.db"),
            output_directory: temp.path().join("out"),
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 1024 * 1024,
        });

        assert!(matches!(result, Err(SnapshotError::NotAFile { .. })));
    }

    #[test]
    fn copies_wal_and_journal() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("chat.db");
        write_sqlite_header(&source);
        fs::write(temp.path().join("chat.db-wal"), &[0u8; 100]).unwrap();
        fs::write(temp.path().join("chat.db-journal"), &[0u8; 50]).unwrap();

        let snapshot = snapshot_database(SnapshotOptions {
            source_path: source,
            output_directory: temp.path().join("out"),
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 1024 * 1024,
        }).unwrap();

        assert!(snapshot.wal_path.as_ref().unwrap().exists());
        assert!(snapshot.journal_path.as_ref().unwrap().exists());
        assert_eq!(snapshot.total_bytes, 512 + 100 + 50);
    }
}
