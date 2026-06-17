//! frePPLe Rust/PyO3 pilot — forecast slice (Engine track E4, slice 2).
//!
//! The numeric port lives in `forecast` (memory-safe, `#![forbid(unsafe_code)]`,
//! `cargo test`ed with no Python). The PyO3 binding below is compiled only into
//! the wheel (`maturin build --features extension-module`) so the parity test can
//! diff it against the verbatim C++ reference.

pub mod forecast;

#[cfg(feature = "extension-module")]
mod bindings {
    use crate::forecast;
    use pyo3::prelude::*;

    /// Returns (smape, standarddeviation, avg, outlier_indices).
    #[pyfunction]
    #[pyo3(signature = (history, order=5, max_deviation=4.0, smape_alfa=0.95, skip=5))]
    fn moving_average(
        history: Vec<f64>,
        order: u32,
        max_deviation: f64,
        smape_alfa: f64,
        skip: u64,
    ) -> (f64, f64, f64, Vec<usize>) {
        let r = forecast::moving_average(&history, order, max_deviation, smape_alfa, skip);
        (r.smape, r.standarddeviation, r.avg, r.outliers)
    }

    #[pymodule]
    fn frepple_forecast(m: &Bound<'_, PyModule>) -> PyResult<()> {
        m.add_function(wrap_pyfunction!(moving_average, m)?)?;
        Ok(())
    }
}
