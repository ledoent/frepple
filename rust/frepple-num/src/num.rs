//! Pure, memory-safe number conversions — the Rust pilot port of the JSON
//! number getters in `src/utils/json.cpp` (`getLong` 790-815, `getUnsignedLong`
//! 817-841, `getInt` 865-890). These are the exact site of the inverted-bound
//! bug fixed earlier in the C++ (`< LONG_MIN` had been `> LONG_MIN`, which made
//! `getLong` return LONG_MIN for ordinary doubles).
//!
//! The whole point of the pilot: the C++ needs hand-written clamping (and got it
//! wrong). In Rust a float->int `as` cast is **saturating** and maps `NaN -> 0`
//! by language definition, so the bug class is impossible by construction — and
//! this module forbids `unsafe` entirely.
#![forbid(unsafe_code)]

/// double -> signed 64-bit, clamped to [i64::MIN, i64::MAX], truncated toward
/// zero, NaN -> 0. Mirrors `JSONData::getLong()`'s JSON_DOUBLE branch.
pub fn clamp_to_long(x: f64) -> i64 {
    x as i64
}

/// double -> signed 32-bit, clamped to [i32::MIN, i32::MAX]. Mirrors
/// `JSONData::getInt()`'s JSON_DOUBLE branch.
pub fn clamp_to_int(x: f64) -> i32 {
    x as i32
}

/// double -> unsigned 64-bit, clamped to [0, u64::MAX]. Mirrors
/// `JSONData::getUnsignedLong()`'s JSON_DOUBLE branch, EXCEPT the C++ has no
/// lower clamp: a negative double there is cast to a signed long and reinterpreted
/// unsigned (wraps to a huge value / UB). Rust saturates negatives to 0 — a
/// strictly safer, defined result. (Flagged in the parity test + report.)
pub fn clamp_to_unsigned_long(x: f64) -> u64 {
    x as u64
}

/// string -> signed 64-bit, `atol`-style: skip leading whitespace, an optional
/// sign, then consume digits until a non-digit; "" / no digits -> 0. Mirrors the
/// JSON_STRING branch (`atol`). Overflow saturates (C `atol` overflow is UB).
pub fn parse_long(s: &str) -> i64 {
    let bytes = s.trim_start().as_bytes();
    let mut i = 0;
    let neg = match bytes.first() {
        Some(b'-') => {
            i = 1;
            true
        }
        Some(b'+') => {
            i = 1;
            false
        }
        _ => false,
    };
    let mut val: i64 = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        let d = (bytes[i] - b'0') as i64;
        val = val.saturating_mul(10).saturating_add(d);
        i += 1;
    }
    if neg {
        val.saturating_neg()
    } else {
        val
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_toward_zero() {
        assert_eq!(clamp_to_long(42.9), 42);
        assert_eq!(clamp_to_long(-42.9), -42);
        assert_eq!(clamp_to_int(7.9), 7);
        assert_eq!(clamp_to_int(-7.9), -7);
    }

    #[test]
    fn regression_ordinary_double_is_not_clamped() {
        // The C++ bug returned LONG_MIN for ordinary doubles (inverted bound).
        // Saturating-cast Rust returns the real value - the bug can't exist here.
        assert_eq!(clamp_to_long(5.0), 5);
        assert_ne!(clamp_to_long(5.0), i64::MIN);
        assert_eq!(clamp_to_int(5.0), 5);
    }

    #[test]
    fn saturates_out_of_range() {
        assert_eq!(clamp_to_long(1e30), i64::MAX);
        assert_eq!(clamp_to_long(-1e30), i64::MIN);
        assert_eq!(clamp_to_int(1e30), i32::MAX);
        assert_eq!(clamp_to_int(-1e30), i32::MIN);
        assert_eq!(clamp_to_unsigned_long(1e30), u64::MAX);
    }

    #[test]
    fn nan_and_inf_are_defined() {
        assert_eq!(clamp_to_long(f64::NAN), 0); // C++ static_cast<long>(NaN) is UB
        assert_eq!(clamp_to_long(f64::INFINITY), i64::MAX);
        assert_eq!(clamp_to_long(f64::NEG_INFINITY), i64::MIN);
        assert_eq!(clamp_to_unsigned_long(f64::NAN), 0);
    }

    #[test]
    fn negative_to_unsigned_saturates_to_zero() {
        // C++ wraps this to a huge value; Rust saturates to 0 (safe + defined).
        assert_eq!(clamp_to_unsigned_long(-5.0), 0);
    }

    #[test]
    fn parses_like_atol() {
        assert_eq!(parse_long("42"), 42);
        assert_eq!(parse_long("-17"), -17);
        assert_eq!(parse_long("+9"), 9);
        assert_eq!(parse_long("  123abc"), 123);
        assert_eq!(parse_long("abc"), 0);
        assert_eq!(parse_long(""), 0);
    }
}
