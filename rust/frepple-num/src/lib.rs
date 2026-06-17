//! frePPLe Rust/PyO3 pilot (Engine track E4).
//!
//! The pure conversion logic lives in `num` (memory-safe, `#![forbid(unsafe_code)]`,
//! unit-tested by `cargo test` with no Python dependency). The PyO3 bindings below
//! are compiled only into the wheel (`maturin build --features extension-module`)
//! so the Python parity test can diff them against the C++ reference.

pub mod num;

#[cfg(feature = "extension-module")]
mod bindings {
    use crate::num;
    use pyo3::prelude::*;

    #[pyfunction]
    fn clamp_to_long(x: f64) -> i64 {
        num::clamp_to_long(x)
    }

    #[pyfunction]
    fn clamp_to_int(x: f64) -> i32 {
        num::clamp_to_int(x)
    }

    #[pyfunction]
    fn clamp_to_unsigned_long(x: f64) -> u64 {
        num::clamp_to_unsigned_long(x)
    }

    #[pyfunction]
    fn parse_long(s: &str) -> i64 {
        num::parse_long(s)
    }

    #[pymodule]
    fn frepple_num(m: &Bound<'_, PyModule>) -> PyResult<()> {
        m.add_function(wrap_pyfunction!(clamp_to_long, m)?)?;
        m.add_function(wrap_pyfunction!(clamp_to_int, m)?)?;
        m.add_function(wrap_pyfunction!(clamp_to_unsigned_long, m)?)?;
        m.add_function(wrap_pyfunction!(parse_long, m)?)?;
        Ok(())
    }
}
