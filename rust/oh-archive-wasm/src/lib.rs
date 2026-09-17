use oh_archive::strict::{read_zip_entries_strict, StrictZipOptions};
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

/// Strictly validate an in-memory ZIP/ZIP64 archive and return the selected
/// members as an array of `{ name, bytes }` objects.
#[wasm_bindgen]
pub fn read_zip_entries_strict_js(archive: &[u8], options_json: &str) -> Result<js_sys::Array, JsValue> {
    let options: StrictZipOptions = serde_json::from_str(options_json)
        .map_err(|e| JsValue::from_str(&format!("invalid options JSON: {e}")))?;
    let entries = read_zip_entries_strict(archive, &options)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = js_sys::Array::new_with_length(entries.len() as u32);
    for (index, entry) in entries.iter().enumerate() {
        let object = js_sys::Object::new();
        js_sys::Reflect::set(&object, &JsValue::from_str("name"), &JsValue::from_str(&entry.name))?;
        js_sys::Reflect::set(
            &object,
            &JsValue::from_str("bytes"),
            &js_sys::Uint8Array::from(entry.bytes.as_slice()),
        )?;
        result.set(index as u32, object.into());
    }
    Ok(result)
}

fn serialize_error(error: ExtractError) -> String {
    serde_json::to_string(&error).unwrap_or_else(|_| r#"{"error":"serialization_failed"}"#.to_string())
}
