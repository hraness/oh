use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};

const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

fn write_sqlite_header(path: &std::path::Path) {
    let mut file = fs::File::create(path).unwrap();
    file.write_all(SQLITE_MAGIC).unwrap();
    file.write_all(&[0u8; 512 - SQLITE_MAGIC.len()]).unwrap();
}

#[test]
fn binary_responds_with_one_json_line() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("sidecar.db");
    write_sqlite_header(&source);
    let out = temp.path().join("out");

    let request = serde_json::json!({
        "sourcePath": source,
        "outputDirectory": out,
        "maxFileBytes": 1024 * 1024,
        "maxTotalBytes": 1024 * 1024,
    });

    let bin = std::env::var("CARGO_BIN_EXE_oh-sqlite-cli")
        .expect("cargo integration test should set binary path");
    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let request_bytes = request.to_string().into_bytes();
    std::thread::spawn(move || {
        stdin.write_all(&request_bytes).unwrap();
        drop(stdin);
    });
    let output = child.wait_with_output().unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();

    let lines: Vec<&str> = stdout.trim().split('\n').collect();
    assert_eq!(lines.len(), 1);
    let parsed: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(parsed.get("error"), None);
    assert!(parsed.get("databasePath").is_some());
}
