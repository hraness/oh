//! Product-neutral sidecar binary for read-only SQLite snapshot isolation.
//!
//! Reads one JSON request per line from stdin and writes one JSON response per
//! line. The request envelope is the camelCase form of `oh_sqlite::SnapshotOptions`;
//! the response is either a successful `oh_sqlite::Snapshot` JSON object or an
//! `oh_sqlite::SnapshotError` tagged object with an `"error"` key.
//!
//! This binary has no JavaScript runtime dependency; it is intended to be
//! spawned from a TypeScript loader that ships with the `@hraness/oh` package.

use std::io::{self, BufRead, Write as _};

use oh_sqlite::{snapshot_database, SnapshotOptions};

fn run_one_request(line: &str) -> String {
    let options: SnapshotOptions = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            return serde_json::to_string(&serde_json::json!({
                "error": "invalid_request",
                "message": error.to_string(),
            }))
            .unwrap_or_else(|_| r#"{"error":"invalid_request"}"#.to_string());
        }
    };

    match snapshot_database(options) {
        Ok(snapshot) => serde_json::to_string(&snapshot)
            .unwrap_or_else(|_| r#"{"error":"serialization_failed"}"#.to_string()),
        Err(error) => serde_json::to_string(&error)
            .unwrap_or_else(|_| r#"{"error":"serialization_failed"}"#.to_string()),
    }
}

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let reader = stdin.lock();
    let stdout = io::stdout();
    let mut handle = stdout.lock();

    for line_result in reader.lines() {
        let line = line_result?;
        let response = run_one_request(&line);
        handle.write_all(response.as_bytes())?;
        handle.write_all(b"\n")?;
        handle.flush()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

    fn write_sqlite_header(path: &std::path::Path) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(SQLITE_MAGIC).unwrap();
        file.write_all(&[0u8; 512 - SQLITE_MAGIC.len()]).unwrap();
    }

    #[test]
    fn rejects_invalid_json() {
        let response = run_one_request("not json");
        assert!(response.contains("invalid_request"));
    }

    #[test]
    fn snapshots_database_via_request() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("test.db");
        write_sqlite_header(&source);
        let out = temp.path().join("out");

        let request = serde_json::json!({
            "sourcePath": source,
            "outputDirectory": out,
        });
        let response = run_one_request(&request.to_string());
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(parsed.get("error"), None);
        assert!(parsed.get("databasePath").unwrap().as_str().unwrap().contains("test.db"));
    }
}
