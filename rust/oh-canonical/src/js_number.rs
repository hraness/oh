//! ECMAScript `Number::toString(x, 10)` formatting for `f64`.
//!
//! This is what `JSON.stringify` uses for numbers. The implementation below is
//! adapted from `parse-rust-core` (Apache-2.0 licensed) and reformatted for
//! `oh-canonical`; it uses `ryu` for the shortest round-tripping decimal digits
//! and then renders them with ECMAScript's exponent and decimal-point rules.
//!
//! Source: <https://docs.rs/parse-rust-core/latest/src/parse_rust_core/js_number.rs.html>
//! License: Apache-2.0

use std::fmt::Write as _;

/// Format an `f64` exactly as ECMAScript's `String(x)` / `JSON.stringify(x)` would.
///
/// Callers serializing to JSON must reject `NaN`, `Infinity`, and `-0` before
/// calling this function; this routine returns the string forms `NaN` and
/// `Infinity` only because `String(x)` uses them.
pub fn to_ecma_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    // Step 2: both zeros render as "0". The sign of -0.0 is deliberately dropped.
    if x == 0.0 {
        return "0".to_string();
    }
    if x < 0.0 {
        return format!("-{}", to_ecma_string(-x));
    }
    if x.is_infinite() {
        return "Infinity".to_string();
    }

    let (digits, n) = shortest_digits(x);
    let k = digits.len() as i32;
    render(&digits, k, n)
}

/// Decompose a positive, finite `f64` into its shortest round-tripping decimal
/// digits and the position of the decimal point.
///
/// Returns `(digits, n)` with no trailing zeros, such that `0.<digits> * 10^n == x`.
fn shortest_digits(x: f64) -> (String, i32) {
    let mut buf = ryu::Buffer::new();
    let s = buf.format_finite(x); // e.g. "100.0", "0.1", "1e20", "1.5e300"

    let (mantissa, exp10) = match s.split_once('e') {
        Some((m, e)) => (m, e.parse::<i32>().unwrap_or(0)),
        None => (s, 0),
    };

    let (int_part, frac_part) = mantissa.split_once('.').unwrap_or((mantissa, ""));

    let (digits, n) = if int_part == "0" {
        let lead_zeros = frac_part.len() - frac_part.trim_start_matches('0').len();
        (frac_part[lead_zeros..].to_string(), -(lead_zeros as i32))
    } else {
        let mut d = String::with_capacity(int_part.len() + frac_part.len());
        d.push_str(int_part);
        d.push_str(frac_part);
        (d, int_part.len() as i32)
    };

    let trimmed = digits.trim_end_matches('0');
    let digits = if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    };

    (digits, n + exp10)
}

/// Steps 6 through 10 of ECMA-262 §6.1.6.1.20, given the digits, their count `k`,
/// and the decimal point position `n`.
fn render(digits: &str, k: i32, n: i32) -> String {
    // Step 6: k <= n <= 21. Integer, padded with n-k trailing zeros.
    if k <= n && n <= 21 {
        let mut s = String::with_capacity(n as usize);
        s.push_str(digits);
        for _ in 0..(n - k) {
            s.push('0');
        }
        return s;
    }
    // Step 7: 0 < n <= 21. Decimal point falls inside the digits.
    if 0 < n && n <= 21 {
        let (int_part, frac_part) = digits.split_at(n as usize);
        return format!("{int_part}.{frac_part}");
    }
    // Step 8: -6 < n <= 0. Leading "0." then -n zeros then the digits.
    if -6 < n && n <= 0 {
        let mut s = String::with_capacity((2 - n) as usize + digits.len());
        s.push_str("0.");
        for _ in 0..(-n) {
            s.push('0');
        }
        s.push_str(digits);
        return s;
    }
    // Steps 9 and 10: exponential. The exponent is n-1, sign always explicit.
    let e = n - 1;
    let sign = if e >= 0 { '+' } else { '-' };
    let mut s = String::new();
    if k == 1 {
        // Step 9: single digit, no decimal point.
        let _ = write!(s, "{digits}e{sign}{}", e.abs());
    } else {
        // Step 10: first digit, point, remainder.
        let (first, rest) = digits.split_at(1);
        let _ = write!(s, "{first}.{rest}e{sign}{}", e.abs());
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_divergences_from_ryu() {
        assert_eq!(to_ecma_string(100.0), "100");
        assert_eq!(to_ecma_string(1e20), "100000000000000000000");
        assert_eq!(to_ecma_string(1e-6), "0.000001");
        assert_eq!(to_ecma_string(-0.0), "0");
        assert_eq!(to_ecma_string(1e30), "1e+30");
        assert_eq!(to_ecma_string(1e21), "1e+21");
        assert_eq!(to_ecma_string(1.5), "1.5");
        assert_eq!(to_ecma_string(0.1), "0.1");
    }
}
