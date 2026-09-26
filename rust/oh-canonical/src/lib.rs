//! Canonical JSON and digest primitives for Oh.
//!
//! This crate implements the strict canonical JSON contract from
//! `oh/src/canonical.ts`. It is designed to produce byte-for-byte identical
//! output to the TypeScript reference implementation for all inputs that the
//! reference accepts as plain JSON values.
//!
//! The entry points are intentionally simple:
//!
//! * [`canonical_json_str`] — parse a JSON text string and re-emit canonical JSON.
//! * [`canonical_json_value`] — canonicalize an already-parsed [`serde_json::Value`].
//! * [`canonical_sha256_str`] — canonical JSON digest.
//! * [`canonical_sha256_value`] — canonical JSON digest from a [`serde_json::Value`].

use serde_json::Value;
use sha2::{Digest, Sha256};

mod js_number;
use js_number::to_ecma_string;

/// Errors that can occur while canonicalizing JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonicalError {
    /// The input is not valid JSON.
    InvalidJson(String),
    /// A number is not canonical (negative zero or non-finite).
    NonCanonicalNumber { path: String },
    /// A value is not a JSON value.
    NonJsonValue { path: String, kind: String },
    /// A cycle was detected in the input value.
    Cycle { path: String },
}

impl std::fmt::Display for CanonicalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CanonicalError::InvalidJson(message) => {
                write!(f, "invalid-json: {message}")
            }
            CanonicalError::NonCanonicalNumber { path } => {
                write!(f, "{path}: noncanonical-number: negative zero is not canonical")
            }
            CanonicalError::NonJsonValue { path, kind } => {
                write!(f, "{path}: non-json-value: cannot encode {kind}")
            }
            CanonicalError::Cycle { path } => {
                write!(f, "{path}: cycle: contains a cycle")
            }
        }
    }
}

impl std::error::Error for CanonicalError {}

/// Parse `text` as JSON and return its canonical JSON representation.
///
/// This is the JSON-text entry point. Because `serde_json::Value` cannot
/// represent cycles, sparse arrays, getters, or non-enumerable properties,
/// those validations are inherent to the type system. The only remaining
/// validation is rejection of `-0.0`.
pub fn canonical_json_str(text: &str) -> Result<String, CanonicalError> {
    let value: Value = serde_json::from_str(text)
        .map_err(|e| CanonicalError::InvalidJson(e.to_string()))?;
    canonical_json_value(&value)
}

/// Canonicalize a [`serde_json::Value`].
pub fn canonical_json_value(value: &Value) -> Result<String, CanonicalError> {
    let mut out = String::new();
    encode_value(value, "$", &mut out)?;
    Ok(out)
}

/// Canonical JSON SHA-256 from a JSON text string.
pub fn canonical_sha256_str(text: &str) -> Result<String, CanonicalError> {
    let canonical = canonical_json_str(text)?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

/// Canonical JSON SHA-256 from a [`serde_json::Value`].
pub fn canonical_sha256_value(value: &Value) -> Result<String, CanonicalError> {
    let canonical = canonical_json_value(value)?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

fn encode_value(value: &Value, path: &str, out: &mut String) -> Result<(), CanonicalError> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(number) => {
            let Some(f) = number.as_f64() else {
                return Err(CanonicalError::NonJsonValue {
                    path: path.to_string(),
                    kind: "number not representable as f64".to_string(),
                });
            };
            if !f.is_finite() {
                return Err(CanonicalError::NonJsonValue {
                    path: path.to_string(),
                    kind: "non-finite number".to_string(),
                });
            }
            if f == 0.0 && f.is_sign_negative() {
                return Err(CanonicalError::NonCanonicalNumber {
                    path: path.to_string(),
                });
            }
            out.push_str(&to_ecma_string(f));
        }
        Value::String(string) => {
            out.push_str(
                &serde_json::to_string(string)
                    .map_err(|e| CanonicalError::InvalidJson(e.to_string()))?,
            );
        }
        Value::Array(elements) => {
            out.push('[');
            for (index, element) in elements.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                let element_path = format!("{path}[{index}]");
                encode_value(element, &element_path, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
            // JavaScript sorts object keys by UTF-16 code unit, not by Unicode
            // scalar value. We compare the UTF-16 code-unit sequences to match
            // `a < b ? -1 : a > b ? 1 : 0` in the reference implementation.
            keys.sort_by(|left, right| compare_utf16(left, right));
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(
                    &serde_json::to_string(key)
                        .map_err(|e| CanonicalError::InvalidJson(e.to_string()))?,
                );
                out.push(':');
                let value_path = format!("{path}.{key}");
                encode_value(&map[key], &value_path, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// Compare two strings the way JavaScript's `<` operator compares strings:
/// lexicographically by UTF-16 code units.
fn compare_utf16(left: &str, right: &str) -> std::cmp::Ordering {
    let mut left_iter = left.encode_utf16();
    let mut right_iter = right.encode_utf16();
    loop {
        match (left_iter.next(), right_iter.next()) {
            (Some(l), Some(r)) => match l.cmp(&r) {
                std::cmp::Ordering::Equal => continue,
                other => return other,
            },
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (None, None) => return std::cmp::Ordering::Equal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primitives() {
        assert_eq!(canonical_json_value(&Value::Null).unwrap(), "null");
        assert_eq!(canonical_json_value(&Value::Bool(true)).unwrap(), "true");
        assert_eq!(canonical_json_value(&Value::Bool(false)).unwrap(), "false");
        assert_eq!(canonical_json_str("1").unwrap(), "1");
        assert_eq!(canonical_json_str("1.0").unwrap(), "1");
        assert_eq!(canonical_json_str("1.5").unwrap(), "1.5");
        assert_eq!(canonical_json_str("1e30").unwrap(), "1e+30");
        assert_eq!(canonical_json_str("1e-7").unwrap(), "1e-7");
        assert_eq!(canonical_json_str("0.000001").unwrap(), "0.000001");
        assert_eq!(canonical_json_str("1000000").unwrap(), "1000000");
        assert_eq!(canonical_json_str("1e20").unwrap(), "100000000000000000000");
        assert_eq!(canonical_json_str("1e21").unwrap(), "1e+21");
        assert_eq!(
            canonical_json_str("-1.3461398955916093e-298").unwrap(),
            "-1.3461398955916093e-298"
        );
        // serde_json parses some extreme integer strings to a different f64 than
        // JavaScript; the reference path uses JS values, not parsed JSON text,
        // so we do not assert text-parity here.
    }

    #[test]
    fn strings() {
        assert_eq!(canonical_json_str("\"hello\"").unwrap(), "\"hello\"");
        assert_eq!(
            canonical_json_str("\"\\n\\t\\\\\\\"\"").unwrap(),
            "\"\\n\\t\\\\\\\"\""
        );
        assert_eq!(canonical_json_str("\"😀\"").unwrap(), "\"😀\"");
        // JSON.stringify and serde_json do not escape U+2028 / U+2029 in strings.
        assert_eq!(canonical_json_str("\"\\u2028\"").unwrap(), "\"\u{2028}\"");
    }

    #[test]
    fn object_key_sorting() {
        assert_eq!(
            canonical_json_str(r#"{"b":1,"a":2}"#).unwrap(),
            r#"{"a":2,"b":1}"#
        );
        assert_eq!(
            canonical_json_str(r#"{"B":1,"A":2,"a":3}"#).unwrap(),
            r#"{"A":2,"B":1,"a":3}"#
        );
    }

    #[test]
    fn nested_structures() {
        assert_eq!(canonical_json_str("[1,2,3]").unwrap(), "[1,2,3]");
        assert_eq!(
            canonical_json_str(r#"{"x":[{"y":1}]}"#).unwrap(),
            r#"{"x":[{"y":1}]}"#
        );
        assert_eq!(canonical_json_str(r#"{}"#).unwrap(), "{}");
    }

    #[test]
    fn rejects_negative_zero() {
        let err = canonical_json_str("-0").unwrap_err();
        assert!(matches!(err, CanonicalError::NonCanonicalNumber { .. }));
    }

    #[test]
    fn rejects_negative_zero_float() {
        let err = canonical_json_str("-0.0").unwrap_err();
        assert!(matches!(err, CanonicalError::NonCanonicalNumber { .. }));
    }

    #[test]
    fn sha256_matches_reference() {
        let digest = canonical_sha256_str(r#"{"b":2,"a":1}"#).unwrap();
        // canonicalSha256({ a: 1, b: 2 }) from the TypeScript reference.
        assert_eq!(
            digest,
            "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
        );
    }
}
