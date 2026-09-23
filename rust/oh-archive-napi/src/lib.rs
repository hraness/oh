#![deny(clippy::all)]

use napi_derive::napi;
use oh_archive::{extract_zip_entries, ExtractOptions};

#[napi]
pub fn extract_zip_entries_json(options_json: String) -> napi::Result<String> {
    let options: ExtractOptions = serde_json::from_str(&options_json)
        .map_err(|e| napi::Error::new(napi::Status::InvalidArg, format!("invalid options JSON: {e}")))?;

    match extract_zip_entries(options) {
        Ok(entries) => serde_json::to_string(&entries)
            .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("serialization failed: {e}"))),
        Err(err) => match serde_json::to_string(&err) {
            Ok(json) => Err(napi::Error::new(napi::Status::GenericFailure, json)),
            Err(e) => Err(napi::Error::new(napi::Status::GenericFailure, format!("serialization failed: {e}"))),
        },
    }
}
