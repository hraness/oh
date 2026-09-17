use oh_archive::{extract_zip_entries, ExtractError, ExtractOptions};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn extract_zip_entries_json(options_json: &str) -> String {
    let options: ExtractOptions = match serde_json::from_str(options_json) {
        Ok(o) => o,
        Err(e) => return serialize_error(ExtractError::InvalidArchive { message: format!("invalid options JSON: {e}") }),
    };

    match extract_zip_entries(options) {
        Ok(entries) => serde_json::to_string(&entries).unwrap_or_else(|_| r#"{"error":"serialization_failed"}"#.to_string()),
        Err(e) => serialize_error(e),
    }
}

fn serialize_error(error: ExtractError) -> String {
    serde_json::to_string(&error).unwrap_or_else(|_| r#"{"error":"serialization_failed"}"#.to_string())
}
