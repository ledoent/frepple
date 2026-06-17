//! Memory-safe Rust port of the Croston intermittent-demand forecast method
//! (Engine track E4, phase 5). Faithful translation of
//! `ForecastSolver::Croston::generateForecast` (src/forecast/timeseries.cpp:1307-1463):
//! an `alfa` grid-search (not Marquardt) over the demand-magnitude `q_i` /
//! inter-demand-period `p_i` smoothing, with upper-only outlier clamping. Same
//! f64 operation order for tight parity; outlier writes -> returned indices.
//!
//! Quirk preserved verbatim: `between_demands` is NOT reset between grid
//! iterations/passes in the C++ (declared outside the loop), so it persists here
//! too.
#![forbid(unsafe_code)]

use crate::common::{smape_weight, weight_table, Forecast, ROUNDING_ERROR};

#[allow(clippy::too_many_arguments)]
pub fn croston(
    history: &[f64],
    min_alfa: f64,
    max_alfa: f64,
    decay_rate: f64,
    max_deviation: f64,
    smape_alfa: f64,
    skip: u64,
    iterations: u64,
) -> Forecast {
    let count = history.len();
    let mut timeseries = history.to_vec();
    timeseries.push(0.0);
    let weight = weight_table(smape_alfa);

    let mut nonzero = 0.0f64;
    let mut totalsum = 0.0f64;
    let mut lastnonzero = 0usize;
    for i in 0..count {
        if timeseries[i] != 0.0 {
            nonzero += 1.0;
            totalsum += timeseries[i];
            lastnonzero = i;
        }
    }
    if nonzero == 0.0 {
        return Forecast {
            smape: 0.0,
            standarddeviation: 0.0,
            forecast: 0.0,
            outliers: Vec::new(),
        };
    }
    let periods_between_demands = count as f64 / nonzero;

    let mut alfa = min_alfa;
    let mut f_i = 0.0f64;
    let niter = iterations;
    let delta = if niter > 1 {
        (max_alfa - min_alfa) / (niter as f64 - 1.0)
    } else {
        0.0
    };
    let mut between_demands: u32 = 1; // persists across iterations (verbatim)
    let mut outliers: Vec<usize> = Vec::new();
    let mut best_error = f64::MAX;
    let mut best_smape = 0.0f64;
    let mut best_f_i = 0.0f64;
    let mut best_standarddeviation = 0.0f64;

    let mut iteration: u64 = 0;
    while iteration < niter {
        let mut standarddeviation = 0.0f64;
        let mut maxdeviation = 0.0f64;
        let mut error_smape = 0.0f64;
        let mut error_smape_weights = 0.0f64;

        for pass in 0..=1 {
            error_smape = 0.0;
            error_smape_weights = 0.0;
            let mut q_i = totalsum / nonzero;
            let mut p_i = count as f64 / nonzero;
            f_i = (1.0 - alfa / 2.0) * q_i / p_i;

            let mut history_i = timeseries[0];
            let mut i = 1usize;
            while i <= count {
                let history_i_min_1 = history_i;
                history_i = timeseries[i];
                if history_i_min_1 != 0.0 {
                    q_i = alfa * history_i_min_1 + (1.0 - alfa) * q_i;
                    p_i = alfa * between_demands as f64 + (1.0 - alfa) * p_i;
                    f_i = (1.0 - alfa / 2.0) * q_i / p_i;
                    between_demands = 1;
                } else if i > lastnonzero
                    && between_demands as f64 > 2.0 * periods_between_demands
                {
                    f_i *= 1.0 - decay_rate;
                    p_i = (1.0 - alfa / 2.0) * q_i / f_i;
                } else {
                    between_demands += 1;
                }
                if i == count {
                    break;
                }
                if pass == 0 {
                    standarddeviation += (f_i - history_i) * (f_i - history_i);
                    if (history_i - f_i).abs() > maxdeviation {
                        maxdeviation = (f_i - history_i).abs();
                    }
                } else if history_i > f_i + max_deviation * standarddeviation {
                    // upper-only clamp (no lower limit for Croston)
                    history_i = f_i + max_deviation * standarddeviation;
                    if iteration == 1 {
                        outliers.push(i);
                    }
                }
                if (i as u64) >= skip && p_i > 0.0 && (f_i + history_i).abs() > ROUNDING_ERROR {
                    let w = smape_weight(&weight, (count - i) as i64);
                    error_smape += (f_i - history_i).abs() / (f_i + history_i).abs() * w;
                    error_smape_weights += w;
                }
                i += 1;
            }

            if pass == 0 {
                standarddeviation = if count > 1 {
                    (standarddeviation / (count as f64 - 1.0)).sqrt()
                } else {
                    0.0
                };
                if standarddeviation > ROUNDING_ERROR {
                    maxdeviation /= standarddeviation;
                }
                if maxdeviation < max_deviation {
                    break;
                }
            }
        }

        // Equal smape is "better" for Croston (prefers higher alfa).
        if error_smape <= best_error {
            best_error = error_smape;
            best_smape = if error_smape_weights != 0.0 {
                error_smape / error_smape_weights
            } else {
                0.0
            };
            best_f_i = f_i;
            best_standarddeviation = standarddeviation;
        }

        if delta != 0.0 {
            alfa += delta;
        } else {
            break;
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
    fn run(h: &[f64]) -> Forecast {
        // engine defaults (timeseries.cpp:1301-1305)
        croston(h, 0.03, 0.8, 0.1, 4.0, 0.95, 5, 15)
    }

    #[test]
    fn all_zero_history_is_zero() {
        let r = run(&vec![0.0; 20]);
        assert_eq!(r.smape, 0.0);
        assert_eq!(r.forecast, 0.0);
    }

    #[test]
    fn intermittent_demand_is_finite_positive() {
        let h = vec![
            5.0, 0.0, 0.0, 8.0, 0.0, 0.0, 0.0, 6.0, 0.0, 3.0, 0.0, 0.0, 7.0, 0.0, 0.0, 4.0,
            0.0, 9.0, 0.0, 0.0,
        ];
        let r = run(&h);
        assert!(r.smape.is_finite(), "smape={}", r.smape);
        assert!(r.forecast.is_finite() && r.forecast > 0.0, "forecast={}", r.forecast);
    }

    #[test]
    fn finite_on_long_oob_series() {
        // intermittent, > MAXBUCKETS
        let long: Vec<f64> = (0..800)
            .map(|x| if x % 4 == 0 { 10.0 + (x % 7) as f64 } else { 0.0 })
            .collect();
        let r = run(&long);
        assert!(r.smape.is_finite() && r.standarddeviation.is_finite());
    }
}
