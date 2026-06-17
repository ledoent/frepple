//! Shared numeric helpers for the forecast-method ports (Engine track E4).
//! Memory-safe by construction; mirrors the constants + `smapeWeight` from
//! `src/forecast/forecast.h` / `src/forecast/timeseries.cpp`.
#![forbid(unsafe_code)]

pub const MAXBUCKETS: usize = 500;
pub const ROUNDING_ERROR: f64 = 0.000001; // include/frepple/utils.h:64
pub const ACCURACY: f64 = 0.01; // timeseries.cpp:30

/// Result of a forecast-method evaluation — mirrors `ForecastSolver::Metrics`
/// plus the constant forecast value and the outlier indices the C++ would have
/// written as ProblemOutlier objects (relative to the series).
#[derive(Debug, Clone, PartialEq)]
pub struct Forecast {
    pub smape: f64,
    pub standarddeviation: f64,
    pub forecast: f64,
    pub outliers: Vec<usize>,
}

/// The exponentially-decaying smape weight table (forecast.h:2627-2629):
/// weight[0] = 1, weight[i+1] = weight[i] * alfa.
pub fn weight_table(smape_alfa: f64) -> [f64; MAXBUCKETS] {
    let mut w = [0.0f64; MAXBUCKETS];
    w[0] = 1.0;
    for i in 0..MAXBUCKETS - 1 {
        w[i + 1] = w[i] * smape_alfa;
    }
    w
}

/// Bounds-safe weight accessor (forecast.h:3051-3054) — the `weight[]` OOB-read
/// site. The C++ needed a hand-written clamp; in Rust the indexing is
/// bounds-checked regardless and the clamp is one line.
pub fn smape_weight(weight: &[f64; MAXBUCKETS], idx: i64) -> f64 {
    let i = idx.clamp(0, (MAXBUCKETS - 1) as i64) as usize;
    weight[i]
}
