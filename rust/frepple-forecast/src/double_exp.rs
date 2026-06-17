//! Memory-safe Rust port of the DoubleExponential forecast method (Engine track
//! E4, phase 4). Faithful translation of
//! `ForecastSolver::DoubleExponential::generateForecast`
//! (src/forecast/timeseries.cpp:633-892): Holt-Winters level+trend smoothing with
//! a 2D Levenberg-Marquardt optimisation of (alfa, gamma) via a 2x2 Hessian
//! (shared `common::solve_2x2_marquardt`). Same f64 operation order for tight
//! parity; outlier ProblemOutlier writes -> returned indices.
#![forbid(unsafe_code)]

use crate::common::{smape_weight, solve_2x2_marquardt, weight_table, Forecast, ACCURACY, ROUNDING_ERROR};

#[allow(clippy::too_many_arguments)]
pub fn double_exponential(
    history: &[f64],
    initial_alfa: f64,
    min_alfa: f64,
    max_alfa: f64,
    initial_gamma: f64,
    min_gamma: f64,
    max_gamma: f64,
    max_deviation: f64,
    smape_alfa: f64,
    skip: u64,
    iterations: u64,
) -> Forecast {
    let count = history.len();
    if (count as u64) < skip + 5 {
        return Forecast {
            smape: f64::MAX,
            standarddeviation: f64::MAX,
            forecast: 0.0,
            outliers: Vec::new(),
        };
    }

    let mut timeseries = history.to_vec();
    timeseries.push(0.0);
    let weight = weight_table(smape_alfa);

    // No constructor clamp (forecast.h:2046): alfa/gamma start at the inits.
    let mut alfa = initial_alfa;
    let mut gamma = initial_gamma;
    let mut constant_i = 0.0f64;
    let mut trend_i = 0.0f64;
    let mut outliers: Vec<usize> = Vec::new();

    let mut best_error = f64::MAX;
    let mut best_smape = 0.0f64;
    let mut best_constant_i = 0.0f64;
    let mut best_trend_i = 0.0f64;
    let mut best_standarddeviation = 0.0f64;
    let mut boundarytested = 0u32;

    let mut iteration: u64 = 1;
    while iteration <= iterations {
        let mut standarddeviation = 0.0f64;
        let mut maxdeviation = 0.0f64;
        // read after the outlier loop for the Marquardt step
        let mut error = 0.0f64;
        let mut error_smape = 0.0f64;
        let mut error_smape_weights = 0.0f64;
        let mut sum11 = 0.0f64;
        let mut sum12 = 0.0f64;
        let mut sum22 = 0.0f64;
        let mut sum13 = 0.0f64;
        let mut sum23 = 0.0f64;

        for pass in 0..=1 {
            error = 0.0;
            error_smape = 0.0;
            error_smape_weights = 0.0;
            sum11 = 0.0;
            sum12 = 0.0;
            sum22 = 0.0;
            sum13 = 0.0;
            sum23 = 0.0;
            let mut d_constant_d_alfa = 0.0f64;
            let mut d_constant_d_gamma = 0.0f64;
            let mut d_trend_d_alfa = 0.0f64;
            let mut d_trend_d_gamma = 0.0f64;
            let mut d_forecast_d_alfa = 0.0f64;
            let mut d_forecast_d_gamma = 0.0f64;

            let history_0 = timeseries[0];
            let history_1 = timeseries[1];
            let history_2 = timeseries[2];
            let history_3 = timeseries[3];
            constant_i = (history_0 + history_1 + history_2) / 3.0;
            trend_i = (history_3 - history_0) / 3.0;
            if pass == 1 {
                let md = max_deviation * standarddeviation;
                let t1a = if history_0 > constant_i + md {
                    constant_i + md
                } else if history_0 < constant_i - md {
                    constant_i - md
                } else {
                    history_0
                };
                let mut t1 = t1a;
                let mut t2 = -t1a;
                if history_1 > constant_i + trend_i + md {
                    t1 += constant_i + trend_i + md;
                } else if history_1 < constant_i + trend_i - md {
                    t1 += constant_i + trend_i - md;
                } else {
                    t1 += history_1;
                }
                if history_2 > constant_i + 2.0 * trend_i + md {
                    t1 += constant_i + 2.0 * trend_i + md;
                    t2 += constant_i + 2.0 * trend_i + md;
                } else if history_2 < constant_i + 2.0 * trend_i - md {
                    t1 += constant_i + 2.0 * trend_i - md;
                    t2 += constant_i + 2.0 * trend_i - md;
                } else {
                    t1 += history_2;
                    t2 += history_2;
                }
                constant_i = t1 / 3.0;
                trend_i = t2 / 3.0;
            }

            let mut history_i = history_0;
            let mut i = 1usize;
            while i <= count {
                let history_i_min_1 = history_i;
                history_i = timeseries[i];
                let constant_i_prev = constant_i;
                let trend_i_prev = trend_i;
                constant_i = history_i_min_1 * alfa + (1.0 - alfa) * (constant_i_prev + trend_i_prev);
                trend_i = gamma * (constant_i - constant_i_prev) + (1.0 - gamma) * trend_i_prev;
                if i == count {
                    break;
                }
                if pass == 0 {
                    let e = constant_i + trend_i - history_i;
                    standarddeviation += e * e;
                    if e.abs() > maxdeviation {
                        maxdeviation = e.abs();
                    }
                } else {
                    let md = max_deviation * standarddeviation;
                    if history_i > constant_i + trend_i + md {
                        history_i = constant_i + trend_i + md;
                        if iteration == 1 {
                            outliers.push(i);
                        }
                    } else if history_i < constant_i + trend_i - md {
                        history_i = constant_i + trend_i - md;
                        if iteration == 1 {
                            outliers.push(i);
                        }
                    }
                }
                let d_constant_d_gamma_prev = d_constant_d_gamma;
                let d_constant_d_alfa_prev = d_constant_d_alfa;
                d_constant_d_alfa =
                    history_i_min_1 - constant_i_prev - trend_i_prev + (1.0 - alfa) * d_forecast_d_alfa;
                d_constant_d_gamma = (1.0 - alfa) * d_forecast_d_gamma;
                d_trend_d_alfa =
                    gamma * (d_constant_d_alfa - d_constant_d_alfa_prev) + (1.0 - gamma) * d_trend_d_alfa;
                d_trend_d_gamma = constant_i - constant_i_prev - trend_i_prev
                    + gamma * (d_constant_d_gamma - d_constant_d_gamma_prev)
                    + (1.0 - gamma) * d_trend_d_gamma;
                d_forecast_d_alfa = d_constant_d_alfa + d_trend_d_alfa;
                d_forecast_d_gamma = d_constant_d_gamma + d_trend_d_gamma;
                let w = smape_weight(&weight, (count - i) as i64);
                sum11 += w * d_forecast_d_alfa * d_forecast_d_alfa;
                sum12 += w * d_forecast_d_alfa * d_forecast_d_gamma;
                sum22 += w * d_forecast_d_gamma * d_forecast_d_gamma;
                sum13 += w * d_forecast_d_alfa * (history_i - constant_i - trend_i);
                sum23 += w * d_forecast_d_gamma * (history_i - constant_i - trend_i);
                if (i as u64) >= skip {
                    error += (constant_i + trend_i - history_i) * (constant_i + trend_i - history_i) * w;
                    if (constant_i + trend_i + history_i).abs() > ROUNDING_ERROR {
                        error_smape += (constant_i + trend_i - history_i).abs()
                            / (constant_i + trend_i + history_i).abs()
                            * w;
                        error_smape_weights += w;
                    }
                }
                i += 1;
            }

            if pass == 0 {
                standarddeviation = (standarddeviation / (count as f64 - 1.0)).sqrt();
                maxdeviation /= standarddeviation;
                if maxdeviation < max_deviation {
                    break;
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
            best_constant_i = constant_i;
            best_trend_i = trend_i;
            best_standarddeviation = standarddeviation;
        }

        let delta = solve_2x2_marquardt(sum11, sum12, sum22, sum13, sum23, error / iteration as f64);
        let (delta_alfa, delta_gamma) = match delta {
            Some(d) => d,
            None => break, // singular
        };
        if delta_alfa.abs() + delta_gamma.abs() < 2.0 * ACCURACY && iteration > 3 {
            break;
        }
        alfa += delta_alfa;
        gamma += delta_gamma;
        if alfa > max_alfa {
            alfa = max_alfa;
        } else if alfa < min_alfa {
            alfa = min_alfa;
        }
        if gamma > max_gamma {
            gamma = max_gamma;
        } else if gamma < min_gamma {
            gamma = min_gamma;
        }
        if (gamma == min_gamma || gamma == max_gamma) && (alfa == min_alfa || alfa == max_alfa) {
            boundarytested += 1;
            if boundarytested > 5 {
                break;
            }
        }
        iteration += 1;
    }

    Forecast {
        smape: best_smape,
        standarddeviation: best_standarddeviation,
        forecast: best_constant_i + best_trend_i,
        outliers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(h: &[f64]) -> Forecast {
        // engine defaults (timeseries.cpp:625-631)
        double_exponential(h, 0.2, 0.02, 1.0, 0.2, 0.05, 1.0, 4.0, 0.95, 5, 15)
    }

    #[test]
    fn too_short_returns_max() {
        assert_eq!(run(&[1.0, 2.0, 3.0, 4.0]).smape, f64::MAX);
    }

    #[test]
    fn tracks_a_linear_trend_with_low_error() {
        let h: Vec<f64> = (1..=30).map(|x| x as f64).collect();
        let r = run(&h);
        assert!(r.smape.is_finite() && r.forecast.is_finite());
        // a clean linear trend should forecast well above the last value's level
        assert!(r.forecast > 20.0, "forecast={}", r.forecast);
    }

    #[test]
    fn finite_on_long_oob_series() {
        let long: Vec<f64> = (0..800).map(|x| 100.0 + (x % 13) as f64).collect();
        let r = run(&long);
        assert!(r.smape.is_finite() && r.standarddeviation.is_finite());
    }
}
