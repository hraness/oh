//! Bounded, untrusted archive parsing.
//!
//! This crate reads ZIP archives without extracting to the filesystem
//! (except for the explicit output directory provided by the caller). It
//! enforces global and per-entry byte limits, rejects encrypted and unsupported
//! entries, and only returns entries matching an allow-list of patterns.

use regex::RegexSet;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use zip::result::ZipError;
use zip::ZipArchive;

/// Options controlling archive extraction.
#[derive(Debug, Clone, Deserialize)]
pub struct ExtractOptions {
    /// Path to the ZIP archive.
    pub archive_path: PathBuf,
    /// Directory where extracted entry files will be written.
    pub output_directory: PathBuf,
    /// Regex patterns; only entries whose full name matches at least one
    /// pattern are extracted.
    pub patterns: Vec<String>,
    /// Maximum total uncompressed bytes across all selected entries.
    #[serde(default = "default_max_total_bytes")]
    pub max_total_bytes: u64,
    /// Maximum uncompressed bytes for any single selected entry.
    #[serde(default = "default_max_entry_bytes")]
    pub max_entry_bytes: u64,
    /// Maximum number of entries in the archive.
    #[serde(default = "default_max_entries")]
    pub max_entries: usize,
}

fn default_max_total_bytes() -> u64 { 768 * 1024 * 1024 }
fn default_max_entry_bytes() -> u64 { 256 * 1024 * 1024 }
fn default_max_entries() -> usize { 100_000 }

/// A successfully extracted entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedEntry {
    /// Full entry name inside the archive.
    pub name: String,
    /// Path where the entry was written.
    pub output_path: PathBuf,
    /// Uncompressed size in bytes.
    pub uncompressed_size: u64,
}

/// Errors returned by extraction.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum ExtractError {
    InvalidArchive { message: String },
    IoError { message: String },
    LimitExceeded { kind: String, limit: u64 },
    EntryLimitExceeded { limit: usize },
    UnsupportedEntry { name: String, reason: String },
    OutputPathError { name: String },
}

impl std::fmt::Display for ExtractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for ExtractError {}

impl From<io::Error> for ExtractError {
    fn from(error: io::Error) -> Self {
        ExtractError::IoError { message: error.to_string() }
    }
}

impl From<ZipError> for ExtractError {
    fn from(error: ZipError) -> Self {
        ExtractError::InvalidArchive { message: error.to_string() }
    }
}

fn sanitize_entry_name(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    let mut components = path.components().peekable();
    let mut safe = PathBuf::new();
    let mut accepted_any = false;

    while let Some(component) = components.peek() {
        match component {
            // Allow a leading root/prefix only if it is the first component and
            // is immediately followed by normal components.
            std::path::Component::RootDir | std::path::Component::Prefix(_) if !accepted_any => {
                components.next();
                continue;
            }
            _ => break,
        }
    }

    for component in components {
        match component {
            std::path::Component::Normal(part) => {
                safe.push(part);
                accepted_any = true;
            }
            _ => return None,
        }
    }

    if !accepted_any {
        return None;
    }
    Some(safe)
}

fn write_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), ExtractError> {
    let parent = path.parent().ok_or_else(|| ExtractError::OutputPathError { name: path.display().to_string() })?;
    std::fs::create_dir_all(parent)?;
    let temp = parent.join(format!(".tmp-{}", std::process::id()));
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, path)?;
    Ok(())
}

/// Extract selected entries from a ZIP archive.
pub fn extract_zip_entries(options: ExtractOptions) -> Result<Vec<ExtractedEntry>, ExtractError> {
    let regex_set = RegexSet::new(&options.patterns)
        .map_err(|e| ExtractError::InvalidArchive { message: format!("invalid pattern: {e}") })?;

    std::fs::create_dir_all(&options.output_directory)?;

    let file = File::open(&options.archive_path)?;
    let mut archive = ZipArchive::new(file)?;

    if archive.len() > options.max_entries {
        return Err(ExtractError::EntryLimitExceeded { limit: options.max_entries });
    }

    let mut total_bytes: u64 = 0;
    let mut extracted = Vec::new();

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().to_string();

        if entry.is_dir() || !regex_set.is_match(&name) {
            continue;
        }

        if entry.encrypted() {
            return Err(ExtractError::UnsupportedEntry { name, reason: "encrypted".to_string() });
        }

        let size = entry.size();
        if size > options.max_entry_bytes {
            return Err(ExtractError::LimitExceeded { kind: format!("entry `{name}`"), limit: options.max_entry_bytes });
        }
        let new_total = total_bytes.checked_add(size).ok_or_else(|| ExtractError::LimitExceeded {
            kind: "total".to_string(),
            limit: options.max_total_bytes,
        })?;
        if new_total > options.max_total_bytes {
            return Err(ExtractError::LimitExceeded { kind: "total".to_string(), limit: options.max_total_bytes });
        }

        let relative = sanitize_entry_name(&name).ok_or_else(|| ExtractError::OutputPathError { name: name.clone() })?;
        let output_path = options.output_directory.join(relative);

        let mut buffer = Vec::with_capacity(size as usize);
        entry.read_to_end(&mut buffer)?;
        if buffer.len() as u64 != size {
            return Err(ExtractError::InvalidArchive { message: format!("entry `{name}` size mismatch") });
        }

        write_file_atomically(&output_path, &buffer)?;

        total_bytes = new_total;
        extracted.push(ExtractedEntry { name, output_path, uncompressed_size: size });
    }

    Ok(extracted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_test_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        for (name, bytes) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn extracts_matching_entries() {
        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("test.zip");
        make_test_zip(&zip_path, &[
            ("data/manifest.js", b"manifest"),
            ("data/tweets.js", b"tweets"),
            ("readme.txt", b"readme"),
        ]);

        let out = temp.path().join("out");
        let result = extract_zip_entries(ExtractOptions {
            archive_path: zip_path,
            output_directory: out.clone(),
            patterns: vec![r"^data/.*\.js$".to_string()],
            max_total_bytes: 1024,
            max_entry_bytes: 1024,
            max_entries: 100,
        }).unwrap();

        assert_eq!(result.len(), 2);
        assert!(std::fs::read_to_string(&result[0].output_path).is_ok());
        assert!(out.join("data/manifest.js").exists());
    }

    #[test]
    fn rejects_entries_exceeding_total_limit() {
        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("test.zip");
        make_test_zip(&zip_path, &[
            ("data/a.js", b"12345"),
            ("data/b.js", b"67890"),
        ]);

        let result = extract_zip_entries(ExtractOptions {
            archive_path: zip_path,
            output_directory: temp.path().join("out"),
            patterns: vec![r"^data/.*\.js$".to_string()],
            max_total_bytes: 5,
            max_entry_bytes: 1024,
            max_entries: 100,
        });

        assert!(matches!(result, Err(ExtractError::LimitExceeded { kind, .. }) if kind == "total"));
    }

    #[test]
    fn rejects_path_traversal() {
        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("test.zip");
        make_test_zip(&zip_path, &[
            ("../escape.js", b"bad"),
        ]);

        let result = extract_zip_entries(ExtractOptions {
            archive_path: zip_path,
            output_directory: temp.path().join("out"),
            patterns: vec![r".*".to_string()],
            max_total_bytes: 1024,
            max_entry_bytes: 1024,
            max_entries: 100,
        });

        assert!(matches!(result, Err(ExtractError::OutputPathError { .. })));
    }
}
