use oh_datalog::{evaluate_projection, materialize_projection, OhProjectionDataset, OhProjectionEvaluationOptions, OhProjectionQuery, OhProjectionRulePack};
use wasm_bindgen::prelude::*;

fn js_error(message: String) -> JsValue {
    JsValue::from_str(&message)
}

#[wasm_bindgen]
pub fn evaluate_projection_js(
    dataset: JsValue,
    rule_pack: JsValue,
    query: JsValue,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let dataset: OhProjectionDataset = serde_wasm_bindgen::from_value(dataset)
        .map_err(|e| js_error(format!("invalid dataset: {e}")))?;
    let rule_pack: OhProjectionRulePack = serde_wasm_bindgen::from_value(rule_pack)
        .map_err(|e| js_error(format!("invalid rule pack: {e}")))?;
    let query: OhProjectionQuery = serde_wasm_bindgen::from_value(query)
        .map_err(|e| js_error(format!("invalid query: {e}")))?;
    let options: OhProjectionEvaluationOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| js_error(format!("invalid options: {e}")))?;

    let result = evaluate_projection(&dataset, &rule_pack, &query, options)
        .map_err(|e| js_error(format!("{e}")))?;

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| js_error(format!("serialization failed: {e}")))
}

#[wasm_bindgen]
pub fn materialize_js(
    dataset: JsValue,
    rule_pack: JsValue,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let dataset: OhProjectionDataset = serde_wasm_bindgen::from_value(dataset)
        .map_err(|e| js_error(format!("invalid dataset: {e}")))?;
    let rule_pack: OhProjectionRulePack = serde_wasm_bindgen::from_value(rule_pack)
        .map_err(|e| js_error(format!("invalid rule pack: {e}")))?;
    let options: OhProjectionEvaluationOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| js_error(format!("invalid options: {e}")))?;

    let result = materialize_projection(&dataset, &rule_pack, options)
        .map_err(|e| js_error(format!("{e}")))?;

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| js_error(format!("serialization failed: {e}")))
}
