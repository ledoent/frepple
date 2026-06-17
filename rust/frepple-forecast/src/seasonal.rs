//! Memory-safe Rust port of the Seasonal (Holt-Winters multiplicative) forecast
//! method (Engine track E4, phase 6) — the most entangled method. Faithful
//! translation of `ForecastSolver::Seasonal::detectCycle`
//! (src/forecast/timeseries.cpp:942-1002) + `generateForecast`
//! (timeseries.cpp:1004-1262): autocorrelation cycle detection, then a
//! seasonal-index Holt-Winters with a 2D Marquardt over (alfa, beta) (shared
//! `common::solve_2x2_marquardt`). No outlier detection. Same f64 op order for
//! tight parity.
//!
//! The seasonal state (L_i, T_i, S_i[period], period) flows generate->apply in
//! the C++ via member fields; here the generate result carries it explicitly so
//! the apply step (engine writes) can be reconstructed when integrated.
#![forbid(unsafe_code)]

use crate::common::{smape_weight, solve_2x2_marquardt, weight_table, ACCURACY, ROUNDING_ERROR};

#[derive(Debug, Clone, PartialEq)]
pub struct SeasonalResult {
    pub smape: f64,
    pub standarddeviation: f64,
    pub forecast: f64,
    pub period: u32,
    pub force: bool,
    pub s_i: Vec<f64>,
}

/// Autocorrelation cycle detection (timeseries.cpp:942-1002). Returns
/// (period, autocorrelation); period 0 means no seasonality.
#[allow(clippy::needless_range_loop)]
fn detect_cycle(
    ts: &[f64],
    count: usize,
    min_period: usize,
    max_period: usize,
    min_autocorrelation: f64,
) -> (usize, f64) {
    if count < min_period * 2 {
        return (0, min_autocorrelation);
    }
    let mut average = 0.0;
    for i in 0..count {
        average += ts[i];
    }
    average /= count as f64;
    let mut variance = 0.0;
    for i in 0..count {
        variance += (ts[i] - average) * (ts[i] - average);
    }
    variance /= count as f64;

    let mut best_period = 0usize;
    let mut best_autocorrelation = min_autocorrelation;
    let mut correlations = [10.0f64; 7];
    let mut p = min_period;
    while p <= max_period && p < count / 2 {
        for i in (1..=6).rev() {
            correlations[i] = correlations[i - 1];
        }
        correlations[0] = 0.0;
        for i in p..count {
            correlations[0] += (ts[i - p] - average) * (ts[i] - average);
        }
        correlations[0] /= (count - p) as f64;
        correlations[0] /= variance;

        if p > min_period + 1
            && correlations[1] > correlations[2] * 1.1
            && correlations[1] > correlations[0] * 1.1
            && correlations[1] > best_autocorrelation
        {
            best_autocorrelation = correlations[1];
            best_period = p - 1;
        }
        if p > min_period + 4
            && correlations[2] > best_autocorrelation
            && correlations[2] > (correlations[0] + correlations[1]) / 2.0
            && correlations[2] > (correlations[3] + correlations[4]) / 2.0
        {
            best_autocorrelation = correlations[2];
            best_period = p - 2;
        }
        if p > min_period + 6
            && correlations[3] > best_autocorrelation
            && correlations[3] > (correlations[0] + correlations[1] + correlations[2]) / 3.0
            && correlations[3] > (correlations[4] + correlations[5] + correlations[6]) / 3.0
        {
            best_autocorrelation = correlations[3];
            best_period = p - 3;
        }
        p += 1;
    }
    (best_period, best_autocorrelation)
}

#[allow(clippy::too_many_arguments, clippy::needless_range_loop)]
pub fn seasonal(
    history: &[f64],
    initial_alfa: f64,
    min_alfa: f64,
    max_alfa: f64,
    initial_beta: f64,
    min_beta: f64,
    max_beta: f64,
    gamma: f64,
    min_period: usize,
    max_period: usize,
    min_autocorrelation: f64,
    max_autocorrelation: f64,
    smape_alfa: f64,
    skip: u64,
    iterations: u64,
) -> SeasonalResult {
    let count = history.len();
    let mut timeseries = history.to_vec();
    timeseries.push(0.0);

    let (period, autocorrelation) =
        detect_cycle(&timeseries, count, min_period, max_period, min_autocorrelation);
    if period == 0 {
        return SeasonalResult {
            smape: f64::MAX,
            standarddeviation: f64::MAX,
            forecast: 0.0,
            period: 0,
            force: false,
            s_i: Vec::new(),
        };
    }

    let weight = weight_table(smape_alfa);
    let pf = period as f64;
    let mut alfa = initial_alfa;
    let mut beta = initial_beta;

    // Initial L_i, T_i, S_i (timeseries.cpp:1035-1057).
    let mut l_i_initial = 0.0;
    let mut t_i_initial = 0.0;
    let mut initial_s_i = vec![0.0f64; period];
    for i in 0..period {
        l_i_initial += timeseries[i];
        t_i_initial += timeseries[i + period] - timeseries[i];
        initial_s_i[i] = 0.0;
    }
    t_i_initial /= pf;
    l_i_initial /= pf;
    let mut cyclecount = 0u32;
    let mut i = 0usize;
    while i + period <= count {
        cyclecount += 1;
        let mut cyclesum = 0.0;
        for j in 0..period {
            cyclesum += timeseries[i + j];
        }
        if cyclesum != 0.0 {
            for j in 0..period {
                initial_s_i[j] += timeseries[i + j] / cyclesum * pf;
            }
        }
        i += period;
    }
    for s in initial_s_i.iter_mut() {
        *s /= cyclecount as f64;
    }

    let mut s_i = vec![0.0f64; period];
    let mut d_s_d_alfa = vec![0.0f64; period];
    let mut d_s_d_beta = vec![0.0f64; period];
    let mut best_s_i = vec![0.0f64; period];
    let mut best_l_i = l_i_initial;
    let mut best_t_i = t_i_initial;
    let mut l_i;
    let mut t_i;
    let mut best_error = f64::MAX;
    let mut best_smape = 0.0f64;
    let mut best_standarddeviation = 0.0f64;
    let mut boundarytested = 0u32;

    let mut iteration: u64 = 1;
    while iteration <= iterations {
        let mut error = 0.0f64;
        let mut error_smape = 0.0f64;
        let mut error_smape_weights = 0.0f64;
        let mut sum11 = 0.0f64;
        let mut sum12 = 0.0f64;
        let mut sum13 = 0.0f64;
        let mut sum22 = 0.0f64;
        let mut sum23 = 0.0f64;
        let mut standarddeviation = 0.0f64;
        let mut d_l_d_alfa = 0.0f64;
        let mut d_l_d_beta = 0.0f64;
        let mut d_t_d_alfa = 0.0f64;
        let mut d_t_d_beta = 0.0f64;
        l_i = l_i_initial;
        t_i = t_i_initial;
        let mut cyclesum = 0.0f64;
        for ii in 0..period {
            s_i[ii] = initial_s_i[ii];
            d_s_d_alfa[ii] = 0.0;
            d_s_d_beta[ii] = 0.0;
            if ii != 0 {
                cyclesum += timeseries[ii - 1];
            }
        }

        let mut prevcycleindex = period - 1;
        let mut cycleindex = 0usize;
        let mut i = period;
        while i <= count {
            let l_i_prev = l_i;
            let actual = if i == count { 0.0 } else { timeseries[i] };
            cyclesum += timeseries[i - 1];
            if i > period {
                cyclesum -= timeseries[i - period - 1];
            }
            l_i = alfa * cyclesum / pf + (1.0 - alfa) * (l_i + t_i);
            if l_i < 0.0 {
                l_i = 0.0;
            }
            t_i = beta * (l_i - l_i_prev) + (1.0 - beta) * t_i;
            let mut factor = -s_i[prevcycleindex];
            if l_i != 0.0 {
                s_i[prevcycleindex] =
                    gamma * timeseries[i - 1] / l_i + (1.0 - gamma) * s_i[prevcycleindex];
            }
            if s_i[prevcycleindex] < 0.0 {
                s_i[prevcycleindex] = 0.0;
            }
            factor = pf / (pf + factor + s_i[prevcycleindex]);
            for s in s_i.iter_mut() {
                *s *= factor;
            }
            if i == count {
                break;
            }
            let d_l_d_alfa_prev = d_l_d_alfa;
            let d_l_d_beta_prev = d_l_d_beta;
            let d_t_d_alfa_prev = d_t_d_alfa;
            let d_t_d_beta_prev = d_t_d_beta;
            let d_s_d_alfa_prev = d_s_d_alfa[prevcycleindex];
            let d_s_d_beta_prev = d_s_d_beta[prevcycleindex];
            d_l_d_alfa =
                cyclesum / pf - (l_i + t_i) + (1.0 - alfa) * (d_l_d_alfa_prev + d_t_d_alfa_prev);
            d_l_d_beta = (1.0 - alfa) * (d_l_d_beta_prev + d_t_d_beta_prev);
            if l_i > ROUNDING_ERROR {
                d_s_d_alfa[prevcycleindex] =
                    -gamma * timeseries[i - 1] / l_i / l_i * d_l_d_alfa_prev
                        + (1.0 - gamma) * d_s_d_alfa_prev;
                d_s_d_beta[prevcycleindex] =
                    -gamma * timeseries[i - 1] / l_i / l_i * d_l_d_beta_prev
                        + (1.0 - gamma) * d_s_d_beta_prev;
            } else {
                d_s_d_alfa[prevcycleindex] = (1.0 - gamma) * d_s_d_alfa_prev;
                d_s_d_beta[prevcycleindex] = (1.0 - gamma) * d_s_d_beta_prev;
            }
            d_t_d_alfa = beta * (d_l_d_alfa - d_l_d_alfa_prev) + (1.0 - beta) * d_t_d_alfa_prev;
            d_t_d_beta = (l_i - l_i_prev) + beta * (d_l_d_beta - d_l_d_beta_prev) - t_i
                + (1.0 - beta) * d_t_d_beta_prev;
            let d_forecast_d_alfa =
                (d_l_d_alfa + d_t_d_alfa) * s_i[cycleindex] + (l_i + t_i) * d_s_d_alfa[cycleindex];
            let d_forecast_d_beta =
                (d_l_d_beta + d_t_d_beta) * s_i[cycleindex] + (l_i + t_i) * d_s_d_beta[cycleindex];
            let forecast_i = (l_i + t_i) * s_i[cycleindex];
            let w = smape_weight(&weight, (count - i) as i64);
            sum11 += w * d_forecast_d_alfa * d_forecast_d_alfa;
            sum12 += w * d_forecast_d_alfa * d_forecast_d_beta;
            sum22 += w * d_forecast_d_beta * d_forecast_d_beta;
            sum13 += w * d_forecast_d_alfa * (actual - forecast_i);
            sum23 += w * d_forecast_d_beta * (actual - forecast_i);
            if (i as u64) >= skip {
                let fcst = (l_i + t_i) * s_i[cycleindex];
                error += (fcst - actual) * (fcst - actual) * w;
                if (fcst + actual).abs() > ROUNDING_ERROR {
                    error_smape += (fcst - actual).abs() / (fcst + actual).abs() * w;
                    error_smape_weights += w;
                    standarddeviation += (fcst - actual) * (fcst - actual);
                }
            }
            cycleindex += 1;
            if cycleindex >= period {
                cycleindex = 0;
            }
            prevcycleindex += 1;
            if prevcycleindex >= period {
                prevcycleindex = 0;
            }
            i += 1;
        }

        if error < best_error {
            best_error = error;
            best_smape = if error_smape_weights != 0.0 {
                error_smape / error_smape_weights
            } else {
                0.0
            };
            best_l_i = l_i;
            best_t_i = t_i;
            best_standarddeviation = (standarddeviation / (count as f64 - pf - 1.0)).sqrt();
            best_s_i[..period].copy_from_slice(&s_i[..period]);
        }

        let delta = solve_2x2_marquardt(sum11, sum12, sum22, sum13, sum23, error / iteration as f64);
        let (delta_alfa, delta_beta) = match delta {
            Some(d) => d,
            None => break,
        };
        if (delta_alfa.abs() + delta_beta.abs()) < 3.0 * ACCURACY && iteration > 3 {
            break;
        }
        alfa += delta_alfa;
        beta += delta_beta;
        if alfa > max_alfa {
            alfa = max_alfa;
        } else if alfa < min_alfa {
            alfa = min_alfa;
        }
        if beta > max_beta {
            beta = max_beta;
        } else if beta < min_beta {
            beta = min_beta;
        }
        if (beta == min_beta || beta == max_beta) && (alfa == min_alfa || alfa == max_alfa) {
            boundarytested += 1;
            if boundarytested > 5 {
                break;
            }
        }
        iteration += 1;
    }

    if (period as u64) > skip {
        best_smape *= count as f64 - skip as f64;
        best_smape /= count as f64 - pf;
    }

    // Restore best + the logged forecast value (timeseries.cpp:1242-1253).
    let l_i = best_l_i;
    let t_i = best_t_i;
    let forecast = (l_i + t_i / pf) * best_s_i[count % period];
    SeasonalResult {
        smape: best_smape,
        standarddeviation: best_standarddeviation,
        forecast,
        period: period as u32,
        force: autocorrelation > max_autocorrelation,
        s_i: best_s_i,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(clippy::too_many_arguments)]
    fn run(h: &[f64]) -> SeasonalResult {
        // engine defaults (timeseries.cpp:929-940)
        seasonal(h, 0.2, 0.02, 1.0, 0.2, 0.2, 1.0, 0.05, 2, 14, 0.5, 0.8, 0.95, 5, 15)
    }

    #[test]
    fn no_cycle_returns_max() {
        // monotone trend, no seasonality -> period 0 -> MAX
        let h: Vec<f64> = (1..=40).map(|x| x as f64).collect();
        let r = run(&h);
        assert_eq!(r.period, 0);
        assert_eq!(r.smape, f64::MAX);
    }

    #[test]
    fn strong_seasonal_is_finite() {
        // a clear period-7 cycle repeated; if detected, outputs must be finite
        let cycle = [10.0, 25.0, 40.0, 55.0, 40.0, 25.0, 10.0];
        let h: Vec<f64> = (0..70).map(|x| cycle[x % 7]).collect();
        let r = run(&h);
        assert!(r.smape.is_finite() && r.standarddeviation.is_finite());
        assert!(r.forecast.is_finite());
        if r.period != 0 {
            assert_eq!(r.s_i.len(), r.period as usize);
        }
    }
}
