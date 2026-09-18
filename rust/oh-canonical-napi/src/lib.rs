use napi::bindgen_prelude::*;
use napi_derive::napi;
use oh_canonical::{canonical_json_str, canonical_sha256_str};

#[napi]
pub fn canonical_json(text: String) -> Result<String> {
    canonical_json_str(&text).map_err(|e| Error::from_reason(e.to_string()))
}

#[napi]
pub fn canonical_sha256(text: String) -> Result<String> {
    canonical_sha256_str(&text).map_err(|e| Error::from_reason(e.to_string()))
}
