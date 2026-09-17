#![deny(clippy::all)]

use napi_derive::napi;
use oh_sqlite::{snapshot_database, SnapshotOptions};

#[napi]
pub fn snapshot_database_json(options_json: String) -> napi::Result<String> {
    let options: SnapshotOptions = serde_json::from_str(&options_json)
        .map_err(|e| napi::Error::new(napi::Status::InvalidArg, format!("invalid options JSON: {e}")))?;

    match snapshot_database(options) {
        Ok(snapshot) => serde_json::to_string(&snapshot)
            .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("serialization failed: {e}"))),
        Err(err) => match serde_json::to_string(&err) {
            Ok(json) => Err(napi::Error::new(napi::Status::GenericFailure, json)),
            Err(e) => Err(napi::Error::new(napi::Status::GenericFailure, format!("serialization failed: {e}"))),
        },
    }
}
