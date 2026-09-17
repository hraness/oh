//! Hostile archive inputs for `oh-archive`.

use std::fs::File;
use std::io::Write;

use oh_archive::{extract_zip_entries, ExtractError, ExtractOptions};
use tempfile::TempDir;

fn make_valid_zip(dir: &std::path::Path, entries: &[(&str, &[u8])]) -> std::path::PathBuf {
    let path = dir.join("valid.zip");
    let file = File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    for (name, bytes) in entries {
        zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
    path
}

#[test]
fn empty_archive_rejected() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("empty.zip");
    File::create(&path).unwrap();
    let err = extract_zip_entries(ExtractOptions {
        archive_path: path,
        output_directory: dir.path().join("out"),
        patterns: vec![".*".to_string()],
        max_total_bytes: 1024,
        max_entry_bytes: 1024,
        max_entries: 100,
    })
    .unwrap_err();
    assert!(matches!(err, ExtractError::InvalidArchive { .. }));
}

#[test]
fn random_bytes_rejected() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("random.zip");
    std::fs::write(&path, (0u8..255u8).collect::<Vec<_>>()).unwrap();
    let err = extract_zip_entries(ExtractOptions {
        archive_path: path,
        output_directory: dir.path().join("out"),
        patterns: vec![".*".to_string()],
        max_total_bytes: 1024,
        max_entry_bytes: 1024,
        max_entries: 100,
    })
    .unwrap_err();
    assert!(matches!(err, ExtractError::InvalidArchive { .. }));
}

#[test]
fn truncated_archive_rejected() {
    let dir = TempDir::new().unwrap();
    let valid = make_valid_zip(dir.path(), &[("data/a.js", b"hello")]);
    let bytes = std::fs::read(&valid).unwrap();
    let truncated_path = dir.path().join("truncated.zip");
    std::fs::write(&truncated_path, &bytes[..bytes.len() / 2]).unwrap();
    let err = extract_zip_entries(ExtractOptions {
        archive_path: truncated_path,
        output_directory: dir.path().join("out"),
        patterns: vec![".*".to_string()],
        max_total_bytes: 1024,
        max_entry_bytes: 1024,
        max_entries: 100,
    })
    .unwrap_err();
    assert!(matches!(err, ExtractError::InvalidArchive { .. }));
}

#[test]
fn entry_count_limit_enforced() {
    let dir = TempDir::new().unwrap();
    let mut entries = Vec::new();
    for i in 0..10 {
        entries.push((format!("data/{i}.js"), "x".as_bytes().to_vec()));
    }
    let entries_ref: Vec<(&str, &[u8])> = entries
        .iter()
        .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
        .collect();
    let path = make_valid_zip(dir.path(), &entries_ref);
    let err = extract_zip_entries(ExtractOptions {
        archive_path: path,
        output_directory: dir.path().join("out"),
        patterns: vec![".*".to_string()],
        max_total_bytes: 1024 * 1024,
        max_entry_bytes: 1024 * 1024,
        max_entries: 5,
    })
    .unwrap_err();
    assert!(matches!(err, ExtractError::EntryLimitExceeded { .. }));
}

#[test]
fn single_oversized_entry_rejected() {
    let dir = TempDir::new().unwrap();
    let path = make_valid_zip(dir.path(), &[("data/big.js", &[0u8; 200])]);
    let err = extract_zip_entries(ExtractOptions {
        archive_path: path,
        output_directory: dir.path().join("out"),
        patterns: vec![".*".to_string()],
        max_total_bytes: 1024,
        max_entry_bytes: 100,
        max_entries: 100,
    })
    .unwrap_err();
    assert!(matches!(err, ExtractError::LimitExceeded { kind, .. } if kind.contains("big")));
}

#[test]
fn total_size_limit_rejected() {
    let dir = TempDir::new().unwrap();
    let path = make_valid_zip(dir.path(), &[
        ("data/a.js", &[0u8; 60]),
        ("data/b.js", &[0u8; 60]),
    ]);
    let err = extract_zip_entries(ExtractOptions {
        archive_path: path,
        output_directory: dir.path().join("out"),
        patterns: vec![".*".to_string()],
        max_total_bytes: 50,
        max_entry_bytes: 1024,
        max_entries: 100,
    })
    .unwrap_err();
    assert!(matches!(err, ExtractError::LimitExceeded { kind, .. } if kind == "total"));
}

#[test]
fn path_traversal_rejected_for_many_shapes() {
    let dir = TempDir::new().unwrap();
    for name in ["../escape.js", "a/../../escape.js", "a/../escape.js"] {
        let path = make_valid_zip(dir.path(), &[(name, b"bad")]);
        let err = extract_zip_entries(ExtractOptions {
            archive_path: path,
            output_directory: dir.path().join("out"),
            patterns: vec![".*".to_string()],
            max_total_bytes: 1024,
            max_entry_bytes: 1024,
            max_entries: 100,
        })
        .unwrap_err();
        assert!(
            matches!(err, ExtractError::OutputPathError { .. }),
            "{name} should be rejected, got {err:?}"
        );
    }
}

#[test]
fn leading_absolute_component_is_normalized_to_relative() {
    let dir = TempDir::new().unwrap();
    let path = make_valid_zip(dir.path(), &[("/absolute.js", b"ok")]);
    let result = extract_zip_entries(ExtractOptions {
        archive_path: path,
        output_directory: dir.path().join("out"),
        patterns: vec![".*".to_string()],
        max_total_bytes: 1024,
        max_entry_bytes: 1024,
        max_entries: 100,
    })
    .unwrap();
    assert_eq!(result.len(), 1);
    assert!(result[0].output_path.ends_with("absolute.js"));
}
