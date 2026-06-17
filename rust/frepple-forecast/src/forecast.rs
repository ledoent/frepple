//! Memory-safe Rust port of the MovingAverage forecast method — Engine track E4,
//! slice 2. A faithful translation of `ForecastSolver::MovingAverage::
//! generateForecast` (src/forecast/timeseries.cpp:294-384) and `smapeWeight`
//! (src/forecast/forecast.h:3041-3054), the exact `weight[]` out-of-bounds-read
//! site fixed earlier in the C++.
//!
//! The numeric core is ported verbatim (same f64 operation order, for tight
//! parity); the engine-model coupling (the two `new ProblemOutlier(...)` writes)
//! is replaced by returning the outlier indices. `#![forbid(unsafe_code)]` makes
//! the `weight[]` OOB read impossible (bounds-checked indexing + the clamp).
#![forbid(unsafe_code)]

const MAXBUCKETS: usize = 500;
const ROUNDING_ERROR: f64 = 0.000001; // include/frepple/utils.h:64

/// Result of the moving-average evaluation — mirrors `ForecastSolver::Metrics`
/// plus the forecast `avg` and the outlier indices the C++ would have written as
/// ProblemOutlier objects (relative to the series; `firstbckt` is 0 here).
#[derive(Debug, Clone, PartialEq)]
pub struct MaResult {
    pub smape: f64,
    pub standarddeviation: f64,
    pub avg: f64,
    pub outliers: Vec<usize>,
}

/// The exponentially-decaying smape weight table (forecast.h:2627-2629):
/// weight[0] = 1, weight[i+1] = weight[i] * alfa.
fn weight_table(smape_alfa: f64) -> [f64; MAXBUCKETS] {
    let mut w = [0.0f64; MAXBUCKETS];
    w[0] = 1.0;
    for i in 0..MAXBUCKETS - 1 {
        w[i + 1] = w[i] * smape_alfa;
    }
    w
}

/// Bounds-safe weight accessor (forecast.h:3051-3054). The C++ needed a hand-
/// written clamp here to avoid an OOB read when the history exceeds MAXBUCKETS;
/// in Rust the clamp is one line and the indexing is bounds-checked regardless.
fn smape_weight(weight: &[f64; MAXBUCKETS], idx: i64) -> f64 {
    let i = idx.clamp(0, (MAXBUCKETS - 1) as i64) as usize;
    weight[i]
}

/// Moving-average forecast + SMAPE error over a history series. `history` is the
/// raw demand history (length = count); a trailing sentinel 0 is appended to
/// match `computeBaselineForecast`. Defaults in the engine: order=5,
/// max_deviation=4.0, smape_alfa=0.95, skip=5.
// `maxdeviation = 0.0` in the count<=1 branch is written then never read (it
// mirrors the C++ verbatim, which is dead there too) - keep it for a faithful
// port rather than diverge from timeseries.cpp.
#[allow(unused_assignments)]
pub fn moving_average(
    history: &[f64],
    order: u32,
    max_deviation: f64,
    smape_alfa: f64,
    skip: u64,
) -> MaResult {
    let order = order.max(1);
    let order_f = order as f64;
    let count = history.len();

    // timeseries = history + trailing sentinel (timeseries.cpp:76-92).
    let mut timeseries = Vec::with_capacity(count + 1);
    timeseries.extend_from_slice(history);
    timeseries.push(0.0);

    let weight = weight_table(smape_alfa);
    let mut clean_history = vec![0.0f64; count + 1];
    let mut standarddeviation = 0.0f64;
    let mut maxdeviation = 0.0f64;
    let mut avg = 0.0f64;
    let mut error_smape = 0.0f64;
    let mut error_smape_weights = 0.0f64;
    let mut outliers: Vec<usize> = Vec::new();

    // Two passes: 0 = scan (compute stddev), 1 = filter (clean outliers).
    for pass in 0..=1 {
        if pass == 1 {
            clean_history[0] = timeseries[0];
        }
        error_smape = 0.0;
        error_smape_weights = 0.0;

        let mut i = 1usize;
        while i <= count {
            let actual = timeseries[i];
            if pass == 0 {
                let mut sum = 0.0;
                let mut j = 0u32;
                while j < order && (j as usize) < i {
                    sum += timeseries[i - j as usize - 1];
                    j += 1;
                }
                avg = sum / order_f;
                if i == count {
                    break;
                }
                standarddeviation += (avg - actual) * (avg - actual);
                if (avg - actual).abs() > maxdeviation {
                    maxdeviation = (avg - actual).abs();
                }
            } else {
                let mut sum = 0.0;
                let mut j = 0u32;
                while j < order && (j as usize) < i {
                    sum += clean_history[i - j as usize - 1];
                    j += 1;
                }
                avg = sum / order_f;
                if i == count {
                    break;
                }
                if actual > avg + max_deviation * standarddeviation {
                    clean_history[i] = avg + max_deviation * standarddeviation;
                    outliers.push(i);
                } else if actual < avg - max_deviation * standarddeviation {
                    clean_history[i] = avg - max_deviation * standarddeviation;
                    outliers.push(i);
                } else {
                    clean_history[i] = actual;
                }
            }

            if i >= skip as usize && i < count && (avg + actual).abs() > ROUNDING_ERROR {
                let w = smape_weight(&weight, (count - i) as i64);
                error_smape += (avg - actual).abs() / (avg + actual).abs() * w;
                error_smape_weights += w;
            }
            i += 1;
        }

        if pass == 0 {
            if count > 1 {
                standarddeviation = (standarddeviation / (count as f64 - 1.0)).sqrt();
                maxdeviation /= standarddeviation;
                if maxdeviation < max_deviation {
                    break; // no outliers -> skip the filter pass
                }
            } else {
                standarddeviation = standarddeviation.sqrt();
                maxdeviation = 0.0;
                break;
            }
        }
    }

    if error_smape_weights != 0.0 {
        error_smape /= error_smape_weights;
    }
    MaResult {
        smape: error_smape,
        standarddeviation,
        avg,
        outliers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ORDER: u32 = 5;
    const MAXDEV: f64 = 4.0;
    const ALFA: f64 = 0.95;
    const SKIP: u64 = 5;

    #[test]
    fn constant_series_has_zero_error() {
        let h = vec![10.0; 30];
        let r = moving_average(&h, ORDER, MAXDEV, ALFA, SKIP);
        assert!(r.smape.abs() < 1e-12, "smape={}", r.smape);
        assert!((r.avg - 10.0).abs() < 1e-9, "avg={}", r.avg);
        assert!(r.outliers.is_empty());
    }

    #[test]
    fn forecast_is_average_of_last_order_values() {
        // Last 5 values: 6,7,8,9,10 -> avg 8.0 is the forecast.
        let h: Vec<f64> = (1..=10).map(|x| x as f64).collect();
        let r = moving_average(&h, ORDER, MAXDEV, ALFA, SKIP);
        assert!((r.avg - 8.0).abs() < 1e-9, "avg={}", r.avg);
    }

    #[test]
    fn detects_an_injected_outlier() {
        let mut h = vec![10.0; 30];
        h[20] = 500.0; // a spike well beyond 4 sigma
        let r = moving_average(&h, ORDER, MAXDEV, ALFA, SKIP);
        assert!(r.outliers.contains(&20), "outliers={:?}", r.outliers);
    }

    #[test]
    fn long_series_past_maxbuckets_is_safe() {
        // count - i exceeds MAXBUCKETS=500 -> the exact OOB-read case. Must not
        // panic and must produce a finite smape (bounds-checked + clamped).
        let h: Vec<f64> = (0..800).map(|x| 100.0 + (x % 7) as f64).collect();
        let r = moving_average(&h, ORDER, MAXDEV, ALFA, SKIP);
        assert!(r.smape.is_finite(), "smape={}", r.smape);
        assert!(r.standarddeviation.is_finite());
    }
}
