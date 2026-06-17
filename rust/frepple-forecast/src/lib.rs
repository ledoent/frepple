//! frePPLe Rust/PyO3 pilot — forecast slice (Engine track E4).
//!
//! Pure numeric ports (memory-safe, `#![forbid(unsafe_code)]`, `cargo test`ed
//! with no Python) live in the method modules; the PyO3 bindings below are
//! compiled only into the wheel (`maturin build --features extension-module`) so
//! the parity tests can diff them against the verbatim C++ references.

pub mod common;
pub mod forecast; // MovingAverage (slice 2)
pub mod single_exp; // SingleExponential (phase 3)

#[cfg(feature = "extension-module")]
mod bindings {
    use crate::{forecast, single_exp};
    use pyo3::prelude::*;

    /// MovingAverage -> (smape, standarddeviation, forecast, outlier_indices).
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
        (r.smape, r.standarddeviation, r.forecast, r.outliers)
    }

    /// SingleExponential -> (smape, standarddeviation, forecast, outlier_indices).
    #[pyfunction]
    #[pyo3(signature = (
        history, initial_alfa=0.2, min_alfa=0.03, max_alfa=1.0,
        max_deviation=4.0, smape_alfa=0.95, skip=5, iterations=15
    ))]
    #[allow(clippy::too_many_arguments)]
    fn single_exponential(
        history: Vec<f64>,
        initial_alfa: f64,
        min_alfa: f64,
        max_alfa: f64,
        max_deviation: f64,
        smape_alfa: f64,
        skip: u64,
        iterations: u64,
    ) -> (f64, f64, f64, Vec<usize>) {
        let r = single_exp::single_exponential(
            &history,
            initial_alfa,
            min_alfa,
            max_alfa,
            max_deviation,
            smape_alfa,
            skip,
            iterations,
        );
        (r.smape, r.standarddeviation, r.forecast, r.outliers)
    }

    #[pymodule]
    fn frepple_forecast(m: &Bound<'_, PyModule>) -> PyResult<()> {
        m.add_function(wrap_pyfunction!(moving_average, m)?)?;
        m.add_function(wrap_pyfunction!(single_exponential, m)?)?;
        Ok(())
    }
}
