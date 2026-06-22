//! Memory-safe Rust port of the SingleExponential forecast method (Engine track
//! E4, phase 3). Faithful translation of
//! `ForecastSolver::SingleExponential::generateForecast`
//! (src/forecast/timeseries.cpp:420-593): single exponential smoothing with a 1D
//! Levenberg-Marquardt optimisation of `alfa`, the two-pass outlier scan/filter,
//! and the weighted SMAPE. Same f64 operation order as the C++ for tight parity;
//! outlier ProblemOutlier writes are replaced by returned indices.
#![forbid(unsafe_code)]

use crate::common::{smape_weight, weight_table, Forecast, ACCURACY, ROUNDING_ERROR};

#[allow(clippy::too_many_arguments)]
pub fn single_exponential(
    history: &[f64],
    initial_alfa: f64,
    min_alfa: f64,
    max_alfa: f64,
    max_deviation: f64,
    smape_alfa: f64,
    skip: u64,
    iterations: u64,
) -> Forecast {
    let count = history.len();
    // Needs at least skip+5 buckets (timeseries.cpp:426-427).
    if (count as u64) < skip + 5 {
        return Forecast {
            smape: f64::MAX,
            standarddeviation: f64::MAX,
            forecast: 0.0,
            outliers: Vec::new(),
        };
    }

    let mut timeseries = history.to_vec();
    timeseries.push(0.0); // trailing sentinel
    let weight = weight_table(smape_alfa);

    // Constructor clamp (forecast.h: SingleExponential(a): alfa(a) then >= min).
    let mut alfa = if initial_alfa < min_alfa {
        min_alfa
    } else {
        initial_alfa
    };
    let mut f_i = 0.0f64;
    let mut outliers: Vec<usize> = Vec::new();
    let mut upper_tested = false;
    let mut lower_tested = false;

    let mut best_error = f64::MAX;
    let mut best_f_i = 0.0f64;
    let mut best_smape = 0.0f64;
    let mut best_standarddeviation = 0.0f64;

    let mut iteration: u64 = 1;
    while iteration <= iterations {
        let mut standarddeviation = 0.0f64;
        let mut maxdeviation = 0.0f64;
        // Read after the outlier loop (last pass wins) for the Marquardt step.
        let mut sum_11 = 0.0f64;
        let mut sum_12 = 0.0f64;
        let mut error = 0.0f64;
        let mut error_smape = 0.0f64;
        let mut error_smape_weights = 0.0f64;

        for pass in 0..=1 {
            let mut df_dalfa_i = 0.0f64;
            sum_11 = 0.0;
            sum_12 = 0.0;
            error_smape = 0.0;
            error_smape_weights = 0.0;
            error = 0.0;

            // Initialise f_i with the average of the first 3 values.
            let history_0 = timeseries[0];
            let history_1 = timeseries[1];
            let history_2 = timeseries[2];
            f_i = (history_0 + history_1 + history_2) / 3.0;
            if pass == 1 {
                let mut t = 0.0;
                for &h in &[history_0, history_1, history_2] {
                    if h > f_i + max_deviation * standarddeviation {
                        t += f_i + max_deviation * standarddeviation;
                    } else if h < f_i - max_deviation * standarddeviation {
                        t += f_i - max_deviation * standarddeviation;
                    } else {
                        t += h;
                    }
                }
                f_i = t / 3.0;
            }

            let mut history_i = history_0;
            let mut i = 1usize;
            while i <= count {
                let history_i_min_1 = history_i;
                history_i = timeseries[i];
                df_dalfa_i = history_i_min_1 - f_i + (1.0 - alfa) * df_dalfa_i;
                f_i = history_i_min_1 * alfa + (1.0 - alfa) * f_i;
                if i == count {
                    break;
                }
                if pass == 0 {
                    standarddeviation += (f_i - history_i) * (f_i - history_i);
                    if (f_i - history_i).abs() > maxdeviation {
                        maxdeviation = (f_i - history_i).abs();
                    }
                } else if history_i > f_i + max_deviation * standarddeviation {
                    history_i = f_i + max_deviation * standarddeviation;
                    if iteration == 1 {
                        outliers.push(i);
                    }
                } else if history_i < f_i - max_deviation * standarddeviation {
                    history_i = f_i - max_deviation * standarddeviation;
                    if iteration == 1 {
                        outliers.push(i);
                    }
                }
                let w = smape_weight(&weight, (count - i) as i64);
                sum_12 += df_dalfa_i * (history_i - f_i) * w;
                sum_11 += df_dalfa_i * df_dalfa_i * w;
                if (i as u64) >= skip {
                    error += (f_i - history_i) * (f_i - history_i) * w;
                    // Note: the C++ divides by (f_i + history_i), NOT its abs.
                    if (f_i + history_i).abs() > ROUNDING_ERROR {
                        error_smape += (f_i - history_i).abs() / (f_i + history_i) * w;
                        error_smape_weights += w;
                    }
                }
                i += 1;
            }

            if pass == 0 {
                standarddeviation = (standarddeviation / (count as f64 - 1.0)).sqrt();
                maxdeviation /= standarddeviation;
                if maxdeviation < max_deviation {
                    break; // no outliers -> skip the filter pass
                }
            }
        }

        if error < best_error {
            best_error = error;
            best_smape = if error_smape_weights != 0.0 {
                error_smape / error_smape_weights
            } else {
                0.0
            };
            best_f_i = f_i;
            best_standarddeviation = standarddeviation;
        }

        // Levenberg-Marquardt damping + alfa update.
        if (sum_11 + error / iteration as f64).abs() > ROUNDING_ERROR {
            sum_11 += error / iteration as f64;
        }
        if sum_11.abs() < ROUNDING_ERROR {
            break;
        }
        let delta = sum_12 / sum_11;
        if delta.abs() < ACCURACY && iteration > 3 {
            break;
        }
        alfa += delta;
        if alfa > max_alfa {
            alfa = max_alfa;
            if upper_tested {
                break;
            }
            upper_tested = true;
        } else if alfa < min_alfa {
            alfa = min_alfa;
            if lower_tested {
                break;
            }
            lower_tested = true;
        }
        iteration += 1;
    }

    Forecast {
        smape: best_smape,
        standarddeviation: best_standarddeviation,
        forecast: best_f_i,
        outliers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Engine defaults (timeseries.cpp:32-36, 416-418).
    const INIT_ALFA: f64 = 0.2;
    const MIN_ALFA: f64 = 0.03;
    const MAX_ALFA: f64 = 1.0;
    const MAXDEV: f64 = 4.0;
    const SMAPE_ALFA: f64 = 0.95;
    const SKIP: u64 = 5;
    const ITERS: u64 = 15;

    fn run(h: &[f64]) -> Forecast {
        single_exponential(
            h, INIT_ALFA, MIN_ALFA, MAX_ALFA, MAXDEV, SMAPE_ALFA, SKIP, ITERS,
        )
    }

    #[test]
    fn too_short_returns_max() {
        let r = run(&[1.0, 2.0, 3.0]); // < skip+5
        assert_eq!(r.smape, f64::MAX);
    }

    #[test]
    fn constant_series_is_near_zero_error() {
        let r = run(&vec![10.0; 30]);
        assert!(r.smape.abs() < 1e-9, "smape={}", r.smape);
        assert!((r.forecast - 10.0).abs() < 1e-6, "forecast={}", r.forecast);
    }

    #[test]
    fn finite_on_trend_and_long_oob_series() {
        let trend: Vec<f64> = (1..=40).map(|x| x as f64).collect();
        let rt = run(&trend);
        assert!(rt.smape.is_finite() && rt.forecast.is_finite());

        // > MAXBUCKETS -> the smapeWeight OOB site; must stay safe + finite.
        let long: Vec<f64> = (0..800).map(|x| 100.0 + (x % 11) as f64).collect();
        let rl = run(&long);
        assert!(rl.smape.is_finite() && rl.standarddeviation.is_finite());
    }
}
