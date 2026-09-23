//! Read-only SQLite snapshot isolation.
//!
//! Copies a SQLite database plus its `-wal` and `-journal` sidecar files into
//! a private temporary directory, verifies ownership and permissions, checks
//! the SQLite magic header, and returns the isolated paths for a read-only
//! consumer. The consumer is responsible for opening the database with its own
//! SQLite library and never writes to the original files.

use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write as _};
use std::path::{Path, PathBuf};

const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";
const SQLITE_MAGIC_LEN: usize = 16;

/// Options controlling snapshot creation.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase")]
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
    SourceChanged { path: String },
    OutputPathError { path: String, reason: String },
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileCheck {
    uid: u32,
    mode: u32,
    size: u64,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(unix)]
    links: u64,
    #[cfg(unix)]
    modified_seconds: i64,
    #[cfg(unix)]
    modified_ns: i64,
    #[cfg(unix)]
    changed_seconds: i64,
    #[cfg(unix)]
    changed_ns: i64,
}

#[cfg(unix)]
fn file_check(meta: &fs::Metadata) -> FileCheck {
    use std::os::unix::fs::MetadataExt;
    FileCheck {
        uid: meta.uid(),
        mode: meta.mode(),
        size: meta.len(),
        dev: meta.dev(),
        ino: meta.ino(),
        links: meta.nlink(),
        modified_seconds: meta.mtime(),
        modified_ns: meta.mtime_nsec(),
        changed_seconds: meta.ctime(),
        changed_ns: meta.ctime_nsec(),
    }
}

#[cfg(not(unix))]
fn file_check(meta: &fs::Metadata) -> FileCheck {
    FileCheck {
        uid: 0,
        mode: 0,
        size: meta.len(),
    }
}

fn inspect_file(path: &Path) -> Result<FileCheck, SnapshotError> {
    let meta = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            SnapshotError::NotAFile {
                path: path.display().to_string(),
            }
        } else {
            error.into()
        }
    })?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(SnapshotError::NotAFile {
            path: path.display().to_string(),
        });
    }
    Ok(file_check(&meta))
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
    #[cfg(unix)]
    {
        let path_str = path.display().to_string();
        if check.uid != current_uid() {
            return Err(SnapshotError::OwnershipError {
                path: path_str,
                reason: format!("expected uid {}, got {}", current_uid(), check.uid),
            });
        }
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
        if check.links != 1 {
            return Err(SnapshotError::PermissionError {
                path: path_str,
                reason: "file must have exactly one hard link".to_string(),
            });
        }
    }
    Ok(())
}

fn open_source_file(source: &Path, expected: FileCheck) -> Result<File, SnapshotError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(source)?;
    if file_check(&file.metadata()?) != expected || inspect_file(source)? != expected {
        return Err(SnapshotError::SourceChanged {
            path: source.display().to_string(),
        });
    }
    Ok(file)
}

fn create_destination_file(destination: &Path) -> Result<File, SnapshotError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(destination).map_err(|error| SnapshotError::OutputPathError {
        path: destination.display().to_string(),
        reason: error.to_string(),
    })
}

fn copy_file_limited(
    source: &Path,
    destination: &Path,
    expected: FileCheck,
    max_bytes: u64,
) -> Result<u64, SnapshotError> {
    if expected.size > max_bytes {
        return Err(SnapshotError::SizeLimitExceeded {
            path: source.display().to_string(),
            limit: max_bytes,
        });
    }

    let mut reader = open_source_file(source, expected)?;
    let mut writer = create_destination_file(destination)?;
    let result = (|| {
        let mut copied = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        while copied < expected.size {
            let remaining = expected.size - copied;
            let wanted = usize::try_from(remaining.min(buffer.len() as u64)).unwrap_or(buffer.len());
            let count = reader.read(&mut buffer[..wanted])?;
            if count == 0 {
                return Err(SnapshotError::SourceChanged {
                    path: source.display().to_string(),
                });
            }
            writer.write_all(&buffer[..count])?;
            copied += count as u64;
        }
        if reader.read(&mut buffer[..1])? != 0
            || file_check(&reader.metadata()?) != expected
            || inspect_file(source)? != expected
        {
            return Err(SnapshotError::SourceChanged {
                path: source.display().to_string(),
            });
        }
        writer.sync_all()?;
        Ok(copied)
    })();
    if result.is_err() {
        drop(writer);
        let _ = fs::remove_file(destination);
    }
    result
}

fn ensure_private_output_directory(path: &Path) -> Result<(), SnapshotError> {
    if !path.is_absolute() {
        return Err(SnapshotError::OutputPathError {
            path: path.display().to_string(),
            reason: "output directory must be absolute".to_string(),
        });
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(SnapshotError::OutputPathError {
                    path: path.display().to_string(),
                    reason: "output path must be a non-symlink directory".to_string(),
                });
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(path)?;
        }
        Err(error) => return Err(error.into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        let metadata = fs::symlink_metadata(path)?;
        if metadata.uid() != current_uid() || metadata.mode() & 0o077 != 0 {
            return Err(SnapshotError::OutputPathError {
                path: path.display().to_string(),
                reason: "output directory must be current-user-owned and private".to_string(),
            });
        }
    }
    Ok(())
}

fn optional_file_check(path: &Path) -> Result<Option<FileCheck>, SnapshotError> {
    match fs::symlink_metadata(path) {
        Ok(_) => inspect_file(path).map(Some),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn path_with_suffix(path: &Path, suffix: &str) -> Result<PathBuf, SnapshotError> {
    let file_name = path.file_name().ok_or_else(|| SnapshotError::NotAFile {
        path: path.display().to_string(),
    })?;
    let mut suffixed = file_name.to_os_string();
    suffixed.push(suffix);
    Ok(path.parent().unwrap_or(Path::new(".")).join(suffixed))
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
    if !options.source_path.is_absolute() || options.max_file_bytes == 0 || options.max_total_bytes == 0 {
        return Err(SnapshotError::NotAFile {
            path: options.source_path.display().to_string(),
        });
    }

    let main_check = inspect_file(&options.source_path)?;
    check_owner(&options.source_path, main_check)?;
    let wal_source = path_with_suffix(&options.source_path, "-wal")?;
    let journal_source = path_with_suffix(&options.source_path, "-journal")?;
    let shm_source = path_with_suffix(&options.source_path, "-shm")?;
    let wal_check = optional_file_check(&wal_source)?;
    let journal_check = optional_file_check(&journal_source)?;
    let shm_check = optional_file_check(&shm_source)?;

    for (path, check, limit) in [
        (&wal_source, wal_check, options.max_file_bytes),
        (&journal_source, journal_check, options.max_file_bytes),
        (&shm_source, shm_check, 64 * 1024 * 1024),
    ] {
        if let Some(check) = check {
            check_owner(path, check)?;
            if check.size > limit {
                return Err(SnapshotError::SizeLimitExceeded {
                    path: path.display().to_string(),
                    limit,
                });
            }
        }
    }

    let total_bytes = [Some(main_check), wal_check, journal_check]
        .into_iter()
        .flatten()
        .try_fold(0u64, |total, check| total.checked_add(check.size))
        .filter(|total| *total <= options.max_total_bytes)
        .ok_or_else(|| SnapshotError::SizeLimitExceeded {
            path: options.source_path.display().to_string(),
            limit: options.max_total_bytes,
        })?;
    ensure_private_output_directory(&options.output_directory)?;

    let base_name = options.source_path.file_name().ok_or_else(|| SnapshotError::NotAFile {
        path: options.source_path.display().to_string(),
    })?;
    let database_path = options.output_directory.join(base_name);
    let wal_path = wal_check.map(|_| options.output_directory.join(wal_source.file_name().unwrap_or_default()));
    let journal_path = journal_check
        .map(|_| options.output_directory.join(journal_source.file_name().unwrap_or_default()));
    let destinations = [
        (options.source_path.as_path(), database_path.as_path(), Some(main_check)),
        (wal_source.as_path(), wal_path.as_deref().unwrap_or(Path::new("")), wal_check),
        (
            journal_source.as_path(),
            journal_path.as_deref().unwrap_or(Path::new("")),
            journal_check,
        ),
    ];
    let mut created = Vec::new();

    let result = (|| {
        for (source, destination, check) in destinations {
            if let Some(check) = check {
                copy_file_limited(source, destination, check, options.max_file_bytes)?;
                created.push(destination);
            }
        }
        verify_sqlite_header(&database_path)?;
        for (path, expected) in [
            (options.source_path.as_path(), Some(main_check)),
            (wal_source.as_path(), wal_check),
            (journal_source.as_path(), journal_check),
            (shm_source.as_path(), shm_check),
        ] {
            if optional_file_check(path)? != expected {
                return Err(SnapshotError::SourceChanged {
                    path: path.display().to_string(),
                });
            }
        }
        Ok(())
    })();

    if let Err(error) = result {
        for path in created {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }
    Ok(Snapshot {
        database_path,
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
        fs::write(temp.path().join("chat.db-wal"), [0u8; 100]).unwrap();
        fs::write(temp.path().join("chat.db-journal"), [0u8; 50]).unwrap();

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

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_link_source() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("chat.db");
        let link = temp.path().join("linked.db");
        write_sqlite_header(&source);
        symlink(&source, &link).unwrap();

        let result = snapshot_database(SnapshotOptions {
            source_path: link,
            output_directory: temp.path().join("out"),
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 1024 * 1024,
        });
        assert!(matches!(result, Err(SnapshotError::NotAFile { .. })));
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_existing_destination_link() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("chat.db");
        let victim = temp.path().join("victim");
        let out = temp.path().join("out");
        write_sqlite_header(&source);
        fs::write(&victim, b"preserve").unwrap();
        fs::create_dir(&out).unwrap();
        symlink(&victim, out.join("chat.db")).unwrap();

        let result = snapshot_database(SnapshotOptions {
            source_path: source,
            output_directory: out,
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 1024 * 1024,
        });
        assert!(matches!(result, Err(SnapshotError::OutputPathError { .. })));
        assert_eq!(fs::read(&victim).unwrap(), b"preserve");
    }

    #[cfg(unix)]
    #[test]
    fn creates_private_snapshot_paths() {
        use std::os::unix::fs::MetadataExt;

        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("chat.db");
        let out = temp.path().join("out");
        write_sqlite_header(&source);

        let snapshot = snapshot_database(SnapshotOptions {
            source_path: source,
            output_directory: out.clone(),
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 1024 * 1024,
        })
        .unwrap();
        assert_eq!(fs::symlink_metadata(&out).unwrap().mode() & 0o777, 0o700);
        assert_eq!(fs::symlink_metadata(snapshot.database_path).unwrap().mode() & 0o777, 0o600);
    }

    #[test]
    fn rejects_total_limit_before_creating_output() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("chat.db");
        let out = temp.path().join("out");
        write_sqlite_header(&source);

        let result = snapshot_database(SnapshotOptions {
            source_path: source,
            output_directory: out.clone(),
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 16,
        });
        assert!(matches!(result, Err(SnapshotError::SizeLimitExceeded { .. })));
        assert!(!out.exists());
    }
}
