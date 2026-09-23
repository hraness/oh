use oh_canonical::{canonical_json_str, canonical_sha256_str};
use wasm_bindgen::prelude::*;

/// Canonicalize a JSON text string.
#[wasm_bindgen]
pub fn canonical_json(text: &str) -> Result<String, JsError> {
    canonical_json_str(text).map_err(|e| JsError::new(&e.to_string()))
}

/// Return the SHA-256 hex digest of the canonical JSON form of `text`.
#[wasm_bindgen]
pub fn canonical_sha256(text: &str) -> Result<String, JsError> {
    canonical_sha256_str(text).map_err(|e| JsError::new(&e.to_string()))
}
