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

/// One 2D Levenberg-Marquardt step for the two-parameter methods (DoubleExp,
/// Seasonal): solve the 2x2 system [sum11 sum12; sum12 sum22] * delta = [sum13;
/// sum23] via Cramer's rule, with the `damping` added to the diagonal. Mirrors
/// timeseries.cpp:824-844: if the damped matrix is near-singular, retry undamped;
/// if still singular, return None (the caller stops iterating).
pub fn solve_2x2_marquardt(
    sum11: f64,
    sum12: f64,
    sum22: f64,
    sum13: f64,
    sum23: f64,
    damping: f64,
) -> Option<(f64, f64)> {
    // Match the C++ bit-for-bit: it adds the damping then SUBTRACTS it on the
    // singular retry ((x+d)-d), which is not always exactly x in f64.
    let mut a11 = sum11 + damping;
    let mut a22 = sum22 + damping;
    let mut det = a11 * a22 - sum12 * sum12;
    if det.abs() < ROUNDING_ERROR {
        a11 -= damping; // try without the damping factor
        a22 -= damping;
        det = a11 * a22 - sum12 * sum12;
        if det.abs() < ROUNDING_ERROR {
            return None; // still singular
        }
    }
    let delta1 = (sum13 * a22 - sum23 * sum12) / det;
    let delta2 = (sum23 * a11 - sum13 * sum12) / det;
    Some((delta1, delta2))
}
