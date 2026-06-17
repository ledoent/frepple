// Parity authority for the Rust forecast pilot (Engine track E4). Standalone
// (no libfrepple): replicates the numeric cores of the frePPLe forecast methods
// VERBATIM from src/forecast/timeseries.cpp, with each `new ProblemOutlier(...)`
// write replaced by recording the outlier index. The Rust ports are diffed
// against this -> true Rust-vs-C++ parity.
//
//   NOTE: keep in sync with src/forecast/timeseries.cpp if those methods change.
//   Build: g++ -O2 -o forecast_reference forecast_reference.cpp
//   Usage (history on stdin):
//     forecast_reference moving_average <order> <maxdev> <alfa> <skip>
//     forecast_reference single_exp <init_alfa> <min_alfa> <max_alfa> <maxdev> <smape_alfa> <skip> <iters>
#include <cfloat>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

static const int MAXBUCKETS = 500;
static const double ROUNDING_ERROR = 0.000001;  // include/frepple/utils.h:64
static const double ACCURACY = 0.01;            // timeseries.cpp:30
static double weight[MAXBUCKETS];

// forecast.h:3051-3054
static inline double smapeWeight(long idx) {
  if (idx < 0) idx = 0;
  if (idx >= MAXBUCKETS) idx = MAXBUCKETS - 1;
  return weight[idx];
}

static void init_weights(double alfa) {
  weight[0] = 1.0;
  for (int i = 0; i < MAXBUCKETS - 1; ++i) weight[i + 1] = weight[i] * alfa;
}

static std::vector<double> read_history() {
  std::vector<double> ts;
  double v;
  while (std::cin >> v) ts.push_back(v);
  return ts;
}

static void emit(double smape, double stddev, double forecast,
                 const std::vector<long>& outliers) {
  printf("{\"smape\":%.17g,\"standarddeviation\":%.17g,\"forecast\":%.17g,\"outliers\":[",
         smape, stddev, forecast);
  for (size_t k = 0; k < outliers.size(); ++k)
    printf("%s%ld", k ? "," : "", outliers[k]);
  printf("]}\n");
}

// ---- MovingAverage (timeseries.cpp:294-384) ----
static int moving_average(int argc, char** argv) {
  if (argc < 6) return 2;
  unsigned int order = static_cast<unsigned int>(atol(argv[2]));
  if (order < 1) order = 1;
  const double Forecast_maxDeviation = atof(argv[3]);
  const double Forecast_SmapeAlfa = atof(argv[4]);
  const unsigned long skip = static_cast<unsigned long>(atol(argv[5]));
  init_weights(Forecast_SmapeAlfa);

  std::vector<double> timeseries = read_history();
  const unsigned int count = static_cast<unsigned int>(timeseries.size());
  timeseries.push_back(0.0);

  std::vector<double> clean_history(count + 1, 0.0);
  std::vector<long> outliers;
  double error_smape = 0.0, error_smape_weights = 0.0;
  double standarddeviation = 0.0, maxdeviation = 0.0, avg = 0.0;
  for (short pass = 0; pass <= 1; ++pass) {
    if (pass) clean_history[0] = timeseries[0];
    error_smape = 0.0;
    error_smape_weights = 0.0;
    for (unsigned int i = 1; i <= count; ++i) {
      double actual = timeseries[i];
      if (pass == 0) {
        double sum = 0.0;
        for (unsigned int j = 0; j < order && j < i; ++j)
          sum += timeseries[i - j - 1];
        avg = sum / order;
        if (i == count) break;
        standarddeviation += (avg - actual) * (avg - actual);
        if (fabs(avg - actual) > maxdeviation) maxdeviation = fabs(avg - actual);
      } else {
        double sum = 0.0;
        for (unsigned int j = 0; j < order && j < i; ++j)
          sum += clean_history[i - j - 1];
        avg = sum / order;
        if (i == count) break;
        if (actual > avg + Forecast_maxDeviation * standarddeviation) {
          clean_history[i] = avg + Forecast_maxDeviation * standarddeviation;
          outliers.push_back(i);
        } else if (actual < avg - Forecast_maxDeviation * standarddeviation) {
          clean_history[i] = avg - Forecast_maxDeviation * standarddeviation;
          outliers.push_back(i);
        } else
          clean_history[i] = actual;
      }
      if (i >= skip && i < count && fabs(avg + actual) > ROUNDING_ERROR) {
        error_smape += fabs(avg - actual) / fabs(avg + actual) * smapeWeight(count - i);
        error_smape_weights += smapeWeight(count - i);
      }
    }
    if (pass == 0) {
      if (count > 1) {
        standarddeviation = sqrt(standarddeviation / (count - 1));
        maxdeviation /= standarddeviation;
        if (maxdeviation < Forecast_maxDeviation) break;
      } else {
        standarddeviation = sqrt(standarddeviation);
        maxdeviation = 0.0;
        break;
      }
    }
  }
  if (error_smape_weights) error_smape /= error_smape_weights;
  emit(error_smape, standarddeviation, avg, outliers);
  return 0;
}

// ---- SingleExponential (timeseries.cpp:420-593) ----
static int single_exp(int argc, char** argv) {
  if (argc < 9) return 2;
  double alfa = atof(argv[2]);
  const double min_alfa = atof(argv[3]);
  const double max_alfa = atof(argv[4]);
  const double Forecast_maxDeviation = atof(argv[5]);
  const double Forecast_SmapeAlfa = atof(argv[6]);
  const unsigned long skip = static_cast<unsigned long>(atol(argv[7]));
  const unsigned long iters = static_cast<unsigned long>(atol(argv[8]));
  if (alfa < min_alfa) alfa = min_alfa;
  init_weights(Forecast_SmapeAlfa);

  std::vector<double> timeseries = read_history();
  const unsigned int count = static_cast<unsigned int>(timeseries.size());
  timeseries.push_back(0.0);

  if (count < skip + 5) {
    emit(DBL_MAX, DBL_MAX, 0.0, {});
    return 0;
  }

  std::vector<long> outliers;
  double error = 0.0, error_smape = 0.0, error_smape_weights = 0.0, best_smape = 0.0;
  double delta, df_dalfa_i, sum_11, sum_12;
  double best_error = DBL_MAX, best_f_i = 0.0, best_standarddeviation = 0.0;
  double f_i = 0.0;
  bool upperboundarytested = false, lowerboundarytested = false;
  unsigned long iteration = 1;
  for (; iteration <= iters; ++iteration) {
    double standarddeviation = 0.0, maxdeviation = 0.0;
    for (short outl = 0; outl <= 1; ++outl) {
      df_dalfa_i = sum_11 = sum_12 = error_smape = error_smape_weights = error = 0.0;
      double history_0 = timeseries[0], history_1 = timeseries[1],
             history_2 = timeseries[2];
      f_i = (history_0 + history_1 + history_2) / 3;
      if (outl == 1) {
        double t = 0.0;
        double hs[3] = {history_0, history_1, history_2};
        for (int k = 0; k < 3; ++k) {
          if (hs[k] > f_i + Forecast_maxDeviation * standarddeviation)
            t += f_i + Forecast_maxDeviation * standarddeviation;
          else if (hs[k] < f_i - Forecast_maxDeviation * standarddeviation)
            t += f_i - Forecast_maxDeviation * standarddeviation;
          else
            t += hs[k];
        }
        f_i = t / 3;
      }
      double history_i = history_0;
      for (unsigned long i = 1; i <= count; ++i) {
        double history_i_min_1 = history_i;
        history_i = timeseries[i];
        df_dalfa_i = history_i_min_1 - f_i + (1 - alfa) * df_dalfa_i;
        f_i = history_i_min_1 * alfa + (1 - alfa) * f_i;
        if (i == count) break;
        if (outl == 0) {
          standarddeviation += (f_i - history_i) * (f_i - history_i);
          if (fabs(f_i - history_i) > maxdeviation)
            maxdeviation = fabs(f_i - history_i);
        } else {
          if (history_i > f_i + Forecast_maxDeviation * standarddeviation) {
            history_i = f_i + Forecast_maxDeviation * standarddeviation;
            if (iteration == 1) outliers.push_back(i);
          } else if (history_i < f_i - Forecast_maxDeviation * standarddeviation) {
            history_i = f_i - Forecast_maxDeviation * standarddeviation;
            if (iteration == 1) outliers.push_back(i);
          }
        }
        sum_12 += df_dalfa_i * (history_i - f_i) * smapeWeight(count - i);
        sum_11 += df_dalfa_i * df_dalfa_i * smapeWeight(count - i);
        if (i >= skip) {
          error += (f_i - history_i) * (f_i - history_i) * smapeWeight(count - i);
          if (fabs(f_i + history_i) > ROUNDING_ERROR) {
            error_smape += fabs(f_i - history_i) / (f_i + history_i) * smapeWeight(count - i);
            error_smape_weights += smapeWeight(count - i);
          }
        }
      }
      if (outl == 0) {
        standarddeviation = sqrt(standarddeviation / (count - 1));
        maxdeviation /= standarddeviation;
        if (maxdeviation < Forecast_maxDeviation) break;
      }
    }
    if (error < best_error) {
      best_error = error;
      best_smape = error_smape_weights ? error_smape / error_smape_weights : 0.0;
      best_f_i = f_i;
      best_standarddeviation = standarddeviation;
    }
    if (fabs(sum_11 + error / iteration) > ROUNDING_ERROR) sum_11 += error / iteration;
    if (fabs(sum_11) < ROUNDING_ERROR) break;
    delta = sum_12 / sum_11;
    if (fabs(delta) < ACCURACY && iteration > 3) break;
    alfa += delta;
    if (alfa > max_alfa) {
      alfa = max_alfa;
      if (upperboundarytested) break;
      upperboundarytested = true;
    } else if (alfa < min_alfa) {
      alfa = min_alfa;
      if (lowerboundarytested) break;
      lowerboundarytested = true;
    }
  }
  emit(best_smape, best_standarddeviation, best_f_i, outliers);
  return 0;
}

// ---- DoubleExponential (timeseries.cpp:633-892) ----
static int double_exp(int argc, char** argv) {
  if (argc < 12) return 2;
  double alfa = atof(argv[2]);
  const double min_alfa = atof(argv[3]);
  const double max_alfa = atof(argv[4]);
  double gamma = atof(argv[5]);
  const double min_gamma = atof(argv[6]);
  const double max_gamma = atof(argv[7]);
  const double Forecast_maxDeviation = atof(argv[8]);
  const double Forecast_SmapeAlfa = atof(argv[9]);
  const unsigned long skip = static_cast<unsigned long>(atol(argv[10]));
  const unsigned long iters = static_cast<unsigned long>(atol(argv[11]));
  init_weights(Forecast_SmapeAlfa);

  std::vector<double> timeseries = read_history();
  const unsigned int count = static_cast<unsigned int>(timeseries.size());
  timeseries.push_back(0.0);
  if (count < skip + 5) {
    emit(DBL_MAX, DBL_MAX, 0.0, {});
    return 0;
  }

  std::vector<long> outliers;
  double error = 0.0, error_smape = 0.0, error_smape_weights = 0.0, delta_alfa,
         delta_gamma, determinant;
  double constant_i_prev, trend_i_prev, d_constant_d_gamma_prev,
      d_constant_d_alfa_prev, d_constant_d_alfa, d_constant_d_gamma,
      d_trend_d_alfa, d_trend_d_gamma, d_forecast_d_alfa, d_forecast_d_gamma,
      sum11, sum12, sum22, sum13, sum23;
  double best_error = DBL_MAX, best_smape = 0, best_constant_i = 0.0,
         best_trend_i = 0.0, best_standarddeviation = 0.0;
  double constant_i = 0.0, trend_i = 0.0;
  unsigned int iteration = 1, boundarytested = 0;
  for (; iteration <= iters; ++iteration) {
    double standarddeviation = 0.0, maxdeviation = 0.0;
    for (short outl = 0; outl <= 1; ++outl) {
      error = error_smape = error_smape_weights = sum11 = sum12 = sum22 = sum13 =
          sum23 = 0.0;
      d_constant_d_alfa = d_constant_d_gamma = d_trend_d_alfa = d_trend_d_gamma =
          0.0;
      d_forecast_d_alfa = d_forecast_d_gamma = 0.0;
      double history_0 = timeseries[0], history_1 = timeseries[1],
             history_2 = timeseries[2], history_3 = timeseries[3];
      constant_i = (history_0 + history_1 + history_2) / 3;
      trend_i = (history_3 - history_0) / 3;
      if (outl == 1) {
        double t1 = 0.0;
        if (history_0 > constant_i + Forecast_maxDeviation * standarddeviation)
          t1 = constant_i + Forecast_maxDeviation * standarddeviation;
        else if (history_0 < constant_i - Forecast_maxDeviation * standarddeviation)
          t1 = constant_i - Forecast_maxDeviation * standarddeviation;
        else
          t1 = history_0;
        double t2 = -t1;
        if (history_1 > constant_i + trend_i + Forecast_maxDeviation * standarddeviation)
          t1 += constant_i + trend_i + Forecast_maxDeviation * standarddeviation;
        else if (history_1 < constant_i + trend_i - Forecast_maxDeviation * standarddeviation)
          t1 += constant_i + trend_i - Forecast_maxDeviation * standarddeviation;
        else
          t1 += history_1;
        if (history_2 > constant_i + 2 * trend_i + Forecast_maxDeviation * standarddeviation) {
          t1 += constant_i + 2 * trend_i + Forecast_maxDeviation * standarddeviation;
          t2 += constant_i + 2 * trend_i + Forecast_maxDeviation * standarddeviation;
        } else if (history_2 < constant_i + 2 * trend_i - Forecast_maxDeviation * standarddeviation) {
          t1 += constant_i + 2 * trend_i - Forecast_maxDeviation * standarddeviation;
          t2 += constant_i + 2 * trend_i - Forecast_maxDeviation * standarddeviation;
        } else {
          t1 += history_2;
          t2 += history_2;
        }
        constant_i = t1 / 3;
        trend_i = t2 / 3;
      }
      double history_i = history_0;
      for (unsigned long i = 1; i <= count; ++i) {
        double history_i_min_1 = history_i;
        history_i = timeseries[i];
        constant_i_prev = constant_i;
        trend_i_prev = trend_i;
        constant_i = history_i_min_1 * alfa + (1 - alfa) * (constant_i_prev + trend_i_prev);
        trend_i = gamma * (constant_i - constant_i_prev) + (1 - gamma) * trend_i_prev;
        if (i == count) break;
        if (outl == 0) {
          standarddeviation += (constant_i + trend_i - history_i) * (constant_i + trend_i - history_i);
          if (fabs(constant_i + trend_i - history_i) > maxdeviation)
            maxdeviation = fabs(constant_i + trend_i - history_i);
        } else {
          if (history_i > constant_i + trend_i + Forecast_maxDeviation * standarddeviation) {
            history_i = constant_i + trend_i + Forecast_maxDeviation * standarddeviation;
            if (iteration == 1) outliers.push_back(i);
          } else if (history_i < constant_i + trend_i - Forecast_maxDeviation * standarddeviation) {
            history_i = constant_i + trend_i - Forecast_maxDeviation * standarddeviation;
            if (iteration == 1) outliers.push_back(i);
          }
        }
        d_constant_d_gamma_prev = d_constant_d_gamma;
        d_constant_d_alfa_prev = d_constant_d_alfa;
        d_constant_d_alfa = history_i_min_1 - constant_i_prev - trend_i_prev + (1 - alfa) * d_forecast_d_alfa;
        d_constant_d_gamma = (1 - alfa) * d_forecast_d_gamma;
        d_trend_d_alfa = gamma * (d_constant_d_alfa - d_constant_d_alfa_prev) + (1 - gamma) * d_trend_d_alfa;
        d_trend_d_gamma = constant_i - constant_i_prev - trend_i_prev +
                          gamma * (d_constant_d_gamma - d_constant_d_gamma_prev) +
                          (1 - gamma) * d_trend_d_gamma;
        d_forecast_d_alfa = d_constant_d_alfa + d_trend_d_alfa;
        d_forecast_d_gamma = d_constant_d_gamma + d_trend_d_gamma;
        sum11 += smapeWeight(count - i) * d_forecast_d_alfa * d_forecast_d_alfa;
        sum12 += smapeWeight(count - i) * d_forecast_d_alfa * d_forecast_d_gamma;
        sum22 += smapeWeight(count - i) * d_forecast_d_gamma * d_forecast_d_gamma;
        sum13 += smapeWeight(count - i) * d_forecast_d_alfa * (history_i - constant_i - trend_i);
        sum23 += smapeWeight(count - i) * d_forecast_d_gamma * (history_i - constant_i - trend_i);
        if (i >= skip) {
          error += (constant_i + trend_i - history_i) * (constant_i + trend_i - history_i) * smapeWeight(count - i);
          if (fabs(constant_i + trend_i + history_i) > ROUNDING_ERROR) {
            error_smape += fabs(constant_i + trend_i - history_i) /
                           fabs(constant_i + trend_i + history_i) * smapeWeight(count - i);
            error_smape_weights += smapeWeight(count - i);
          }
        }
      }
      if (outl == 0) {
        standarddeviation = sqrt(standarddeviation / (count - 1));
        maxdeviation /= standarddeviation;
        if (maxdeviation < Forecast_maxDeviation) break;
      }
    }
    if (error < best_error) {
      best_error = error;
      best_smape = error_smape_weights ? error_smape / error_smape_weights : 0.0;
      best_constant_i = constant_i;
      best_trend_i = trend_i;
      best_standarddeviation = standarddeviation;
    }
    sum11 += error / iteration;
    sum22 += error / iteration;
    determinant = sum11 * sum22 - sum12 * sum12;
    if (fabs(determinant) < ROUNDING_ERROR) {
      sum11 -= error / iteration;
      sum22 -= error / iteration;
      determinant = sum11 * sum22 - sum12 * sum12;
      if (fabs(determinant) < ROUNDING_ERROR) break;
    }
    delta_alfa = (sum13 * sum22 - sum23 * sum12) / determinant;
    delta_gamma = (sum23 * sum11 - sum13 * sum12) / determinant;
    if (fabs(delta_alfa) + fabs(delta_gamma) < 2 * ACCURACY && iteration > 3) break;
    alfa += delta_alfa;
    gamma += delta_gamma;
    if (alfa > max_alfa)
      alfa = max_alfa;
    else if (alfa < min_alfa)
      alfa = min_alfa;
    if (gamma > max_gamma)
      gamma = max_gamma;
    else if (gamma < min_gamma)
      gamma = min_gamma;
    if ((gamma == min_gamma || gamma == max_gamma) && (alfa == min_alfa || alfa == max_alfa)) {
      if (boundarytested++ > 5) break;
    }
  }
  emit(best_smape, best_standarddeviation, best_constant_i + best_trend_i, outliers);
  return 0;
}

// ---- Croston (timeseries.cpp:1307-1463) ----
static int croston(int argc, char** argv) {
  if (argc < 9) return 2;
  const double min_alfa = atof(argv[2]);
  const double max_alfa = atof(argv[3]);
  const double decay_rate = atof(argv[4]);
  const double Forecast_maxDeviation = atof(argv[5]);
  const double Forecast_SmapeAlfa = atof(argv[6]);
  const unsigned long skip = static_cast<unsigned long>(atol(argv[7]));
  const unsigned long niter = static_cast<unsigned long>(atol(argv[8]));
  init_weights(Forecast_SmapeAlfa);

  std::vector<double> timeseries = read_history();
  const unsigned int count = static_cast<unsigned int>(timeseries.size());
  timeseries.push_back(0.0);

  double nonzero = 0.0, totalsum = 0.0;
  unsigned long lastnonzero = 0;
  for (unsigned long i = 0; i < count; ++i) {
    if (timeseries[i]) {
      ++nonzero;
      totalsum += timeseries[i];
      lastnonzero = i;
    }
  }
  double periods_between_demands = count / nonzero;
  if (!nonzero) {
    emit(0, 0, 0, {});
    return 0;
  }

  std::vector<long> outliers;
  unsigned int iteration = 0;
  double error_smape = 0.0, error_smape_weights = 0.0, best_smape = 0.0;
  double q_i, p_i, f_i = 0.0;
  double best_error = DBL_MAX, best_f_i = 0.0, best_standarddeviation = 0.0;
  unsigned int between_demands = 1;
  double alfa = min_alfa;
  double delta = (niter > 1) ? (max_alfa - min_alfa) / (niter - 1) : 0.0;
  for (; iteration < niter; ++iteration) {
    double standarddeviation = 0.0, maxdeviation = 0.0;
    for (short outl = 0; outl <= 1; ++outl) {
      error_smape = error_smape_weights = 0.0;
      q_i = totalsum / nonzero;
      p_i = count / nonzero;
      f_i = (1 - alfa / 2) * q_i / p_i;
      double history_i = timeseries[0];
      for (unsigned long i = 1; i <= count; ++i) {
        double history_i_min_1 = history_i;
        history_i = timeseries[i];
        if (history_i_min_1) {
          q_i = alfa * history_i_min_1 + (1 - alfa) * q_i;
          p_i = alfa * between_demands + (1 - alfa) * p_i;
          f_i = (1 - alfa / 2) * q_i / p_i;
          between_demands = 1;
        } else if (i > lastnonzero && between_demands > 2 * periods_between_demands) {
          f_i = f_i * (1 - decay_rate);
          p_i = (1 - alfa / 2) * q_i / f_i;
        } else
          ++between_demands;
        if (i == count) break;
        if (outl == 0) {
          standarddeviation += (f_i - history_i) * (f_i - history_i);
          if (fabs(history_i - f_i) > maxdeviation) maxdeviation = fabs(f_i - history_i);
        } else {
          if (history_i > f_i + Forecast_maxDeviation * standarddeviation) {
            history_i = f_i + Forecast_maxDeviation * standarddeviation;
            if (iteration == 1) outliers.push_back(i);
          }
        }
        if (i >= skip && p_i > 0) {
          if (fabs(f_i + history_i) > ROUNDING_ERROR) {
            error_smape += fabs(f_i - history_i) / fabs(f_i + history_i) * smapeWeight(count - i);
            error_smape_weights += smapeWeight(count - i);
          }
        }
      }
      if (outl == 0) {
        standarddeviation = (count > 1) ? sqrt(standarddeviation / (count - 1)) : 0.0;
        if (standarddeviation > ROUNDING_ERROR) maxdeviation /= standarddeviation;
        if (maxdeviation < Forecast_maxDeviation) break;
      }
    }
    if (error_smape <= best_error) {
      best_error = error_smape;
      best_smape = error_smape_weights ? error_smape / error_smape_weights : 0.0;
      best_f_i = f_i;
      best_standarddeviation = standarddeviation;
    }
    if (delta)
      alfa += delta;
    else
      break;
  }
  emit(best_smape, best_standarddeviation, best_f_i, outliers);
  return 0;
}

// ---- Seasonal (timeseries.cpp:942-1262) ----
static void detect_cycle(const std::vector<double>& ts, unsigned int count,
                         unsigned int min_period, unsigned int max_period,
                         double min_autocorrelation, unsigned short& period,
                         double& autocorrelation) {
  period = 0;
  autocorrelation = min_autocorrelation;
  if (count < min_period * 2) return;
  double average = 0.0;
  for (unsigned int i = 0; i < count; ++i) average += ts[i];
  average /= count;
  double variance = 0.0;
  for (unsigned int i = 0; i < count; ++i)
    variance += (ts[i] - average) * (ts[i] - average);
  variance /= count;
  unsigned short best_period = 0;
  double best_autocorrelation = min_autocorrelation;
  double correlations[7] = {10, 10, 10, 10, 10, 10, 10};
  for (auto p = min_period; p <= max_period && p < count / 2; ++p) {
    for (short i = 6; i > 0; --i) correlations[i] = correlations[i - 1];
    correlations[0] = 0.0;
    for (unsigned int i = p; i < count; ++i)
      correlations[0] += (ts[i - p] - average) * (ts[i] - average);
    correlations[0] /= count - p;
    correlations[0] /= variance;
    if (p > min_period + 1 && correlations[1] > correlations[2] * 1.1 &&
        correlations[1] > correlations[0] * 1.1 &&
        correlations[1] > best_autocorrelation) {
      best_autocorrelation = correlations[1];
      best_period = p - 1;
    }
    if (p > min_period + 4 && correlations[2] > best_autocorrelation &&
        correlations[2] > (correlations[0] + correlations[1]) / 2 &&
        correlations[2] > (correlations[3] + correlations[4]) / 2) {
      best_autocorrelation = correlations[2];
      best_period = p - 2;
    }
    if (p > min_period + 6 && correlations[3] > best_autocorrelation &&
        correlations[3] > (correlations[0] + correlations[1] + correlations[2]) / 3 &&
        correlations[3] > (correlations[4] + correlations[5] + correlations[6]) / 3) {
      best_autocorrelation = correlations[3];
      best_period = p - 3;
    }
  }
  autocorrelation = best_autocorrelation;
  period = best_period;
}

static int seasonal(int argc, char** argv) {
  if (argc < 16) return 2;
  double alfa = atof(argv[2]);
  const double min_alfa = atof(argv[3]);
  const double max_alfa = atof(argv[4]);
  double beta = atof(argv[5]);
  const double min_beta = atof(argv[6]);
  const double max_beta = atof(argv[7]);
  const double gamma = atof(argv[8]);
  const unsigned int min_period = static_cast<unsigned int>(atol(argv[9]));
  const unsigned int max_period = static_cast<unsigned int>(atol(argv[10]));
  const double min_autocorrelation = atof(argv[11]);
  const double max_autocorrelation = atof(argv[12]);
  const double Forecast_SmapeAlfa = atof(argv[13]);
  const unsigned long skip = static_cast<unsigned long>(atol(argv[14]));
  const unsigned long iters = static_cast<unsigned long>(atol(argv[15]));
  init_weights(Forecast_SmapeAlfa);

  std::vector<double> timeseries = read_history();
  const unsigned int count = static_cast<unsigned int>(timeseries.size());
  timeseries.push_back(0.0);

  unsigned short period;
  double autocorrelation;
  detect_cycle(timeseries, count, min_period, max_period, min_autocorrelation,
               period, autocorrelation);
  if (!period) {
    printf("{\"smape\":%.17g,\"standarddeviation\":%.17g,\"forecast\":0,"
           "\"period\":0,\"force\":false,\"s_i\":[]}\n",
           DBL_MAX, DBL_MAX);
    return 0;
  }

  double error = 0.0, error_smape = 0.0, error_smape_weights = 0.0, determinant,
         delta_alfa, delta_beta;
  double forecast_i, d_forecast_d_alfa, d_forecast_d_beta;
  double d_L_d_alfa, d_L_d_beta, d_T_d_alfa, d_T_d_beta;
  double d_S_d_alfa[80], d_S_d_beta[80];
  double d_L_d_alfa_prev, d_L_d_beta_prev, d_T_d_alfa_prev, d_T_d_beta_prev,
      d_S_d_alfa_prev, d_S_d_beta_prev;
  double sum11, sum12, sum13, sum22, sum23;
  double best_error = DBL_MAX, best_smape = 0, best_standarddeviation = 0.0;
  double initial_S_i[80], best_S_i[80], S_i[80];
  double L_i, T_i;

  double L_i_initial = 0.0, T_i_initial = 0.0;
  for (unsigned short i = 0; i < period; ++i) {
    L_i_initial += timeseries[i];
    T_i_initial += timeseries[i + period] - timeseries[i];
    initial_S_i[i] = 0.0;
  }
  T_i_initial /= period;
  L_i_initial = L_i_initial / period;
  double best_L_i = L_i_initial, best_T_i = T_i_initial;
  unsigned short cyclecount = 0;
  for (unsigned int i = 0; i + period <= count; i += period) {
    ++cyclecount;
    double cyclesum = 0.0;
    for (unsigned short j = 0; j < period; ++j) cyclesum += timeseries[i + j];
    if (cyclesum)
      for (unsigned short j = 0; j < period; ++j)
        initial_S_i[j] += timeseries[i + j] / cyclesum * period;
  }
  for (unsigned long i = 0; i < period; ++i) initial_S_i[i] /= cyclecount;

  double L_i_prev, cyclesum, standarddeviation = 0.0;
  unsigned int iteration = 1, boundarytested = 0;
  for (; iteration <= iters; ++iteration) {
    error = error_smape = error_smape_weights = sum11 = sum12 = sum13 = sum22 =
        sum23 = standarddeviation = 0.0;
    d_L_d_alfa = d_L_d_beta = d_T_d_alfa = d_T_d_beta = 0.0;
    L_i = L_i_initial;
    T_i = T_i_initial;
    cyclesum = 0.0;
    for (unsigned short i = 0; i < period; ++i) {
      S_i[i] = initial_S_i[i];
      d_S_d_alfa[i] = 0.0;
      d_S_d_beta[i] = 0.0;
      if (i) cyclesum += timeseries[i - 1];
    }
    unsigned int prevcycleindex = period - 1, cycleindex = 0;
    for (unsigned int i = period; i <= count; ++i) {
      L_i_prev = L_i;
      double actual = (i == count) ? 0 : timeseries[i];
      cyclesum += timeseries[i - 1];
      if (i > period) cyclesum -= timeseries[i - period - 1];
      L_i = alfa * cyclesum / period + (1 - alfa) * (L_i + T_i);
      if (L_i < 0) L_i = 0.0;
      T_i = beta * (L_i - L_i_prev) + (1 - beta) * T_i;
      double factor = -S_i[prevcycleindex];
      if (L_i)
        S_i[prevcycleindex] =
            gamma * timeseries[i - 1] / L_i + (1 - gamma) * S_i[prevcycleindex];
      if (S_i[prevcycleindex] < 0.0) S_i[prevcycleindex] = 0.0;
      factor = period / (period + factor + S_i[prevcycleindex]);
      for (unsigned short i2 = 0; i2 < period; ++i2) S_i[i2] *= factor;
      if (i == count) break;
      d_L_d_alfa_prev = d_L_d_alfa;
      d_L_d_beta_prev = d_L_d_beta;
      d_T_d_alfa_prev = d_T_d_alfa;
      d_T_d_beta_prev = d_T_d_beta;
      d_S_d_alfa_prev = d_S_d_alfa[prevcycleindex];
      d_S_d_beta_prev = d_S_d_beta[prevcycleindex];
      d_L_d_alfa = cyclesum / period - (L_i + T_i) +
                   (1 - alfa) * (d_L_d_alfa_prev + d_T_d_alfa_prev);
      d_L_d_beta = (1 - alfa) * (d_L_d_beta_prev + d_T_d_beta_prev);
      if (L_i > ROUNDING_ERROR) {
        d_S_d_alfa[prevcycleindex] =
            -gamma * timeseries[i - 1] / L_i / L_i * d_L_d_alfa_prev +
            (1 - gamma) * d_S_d_alfa_prev;
        d_S_d_beta[prevcycleindex] =
            -gamma * timeseries[i - 1] / L_i / L_i * d_L_d_beta_prev +
            (1 - gamma) * d_S_d_beta_prev;
      } else {
        d_S_d_alfa[prevcycleindex] = (1 - gamma) * d_S_d_alfa_prev;
        d_S_d_beta[prevcycleindex] = (1 - gamma) * d_S_d_beta_prev;
      }
      d_T_d_alfa = beta * (d_L_d_alfa - d_L_d_alfa_prev) + (1 - beta) * d_T_d_alfa_prev;
      d_T_d_beta = (L_i - L_i_prev) + beta * (d_L_d_beta - d_L_d_beta_prev) - T_i +
                   (1 - beta) * d_T_d_beta_prev;
      d_forecast_d_alfa = (d_L_d_alfa + d_T_d_alfa) * S_i[cycleindex] +
                          (L_i + T_i) * d_S_d_alfa[cycleindex];
      d_forecast_d_beta = (d_L_d_beta + d_T_d_beta) * S_i[cycleindex] +
                          (L_i + T_i) * d_S_d_beta[cycleindex];
      forecast_i = (L_i + T_i) * S_i[cycleindex];
      sum11 += smapeWeight(count - i) * d_forecast_d_alfa * d_forecast_d_alfa;
      sum12 += smapeWeight(count - i) * d_forecast_d_alfa * d_forecast_d_beta;
      sum22 += smapeWeight(count - i) * d_forecast_d_beta * d_forecast_d_beta;
      sum13 += smapeWeight(count - i) * d_forecast_d_alfa * (actual - forecast_i);
      sum23 += smapeWeight(count - i) * d_forecast_d_beta * (actual - forecast_i);
      if (i >= skip) {
        double fcst = (L_i + T_i) * S_i[cycleindex];
        error += (fcst - actual) * (fcst - actual) * smapeWeight(count - i);
        if (fabs(fcst + actual) > ROUNDING_ERROR) {
          error_smape += fabs(fcst - actual) / fabs(fcst + actual) * smapeWeight(count - i);
          error_smape_weights += smapeWeight(count - i);
          standarddeviation += (fcst - actual) * (fcst - actual);
        }
      }
      if (++cycleindex >= period) cycleindex = 0;
      if (++prevcycleindex >= period) prevcycleindex = 0;
    }
    if (error < best_error) {
      best_error = error;
      best_smape = error_smape_weights ? error_smape / error_smape_weights : 0.0;
      best_L_i = L_i;
      best_T_i = T_i;
      best_standarddeviation = sqrt(standarddeviation / (count - period - 1));
      for (unsigned short i = 0; i < period; ++i) best_S_i[i] = S_i[i];
    }
    sum11 += error / iteration;
    sum22 += error / iteration;
    determinant = sum11 * sum22 - sum12 * sum12;
    if (fabs(determinant) < ROUNDING_ERROR) {
      sum11 -= error / iteration;
      sum22 -= error / iteration;
      determinant = sum11 * sum22 - sum12 * sum12;
      if (fabs(determinant) < ROUNDING_ERROR) break;
    }
    delta_alfa = (sum13 * sum22 - sum23 * sum12) / determinant;
    delta_beta = (sum23 * sum11 - sum13 * sum12) / determinant;
    if ((fabs(delta_alfa) + fabs(delta_beta)) < 3 * ACCURACY && iteration > 3) break;
    alfa += delta_alfa;
    beta += delta_beta;
    if (alfa > max_alfa)
      alfa = max_alfa;
    else if (alfa < min_alfa)
      alfa = min_alfa;
    if (beta > max_beta)
      beta = max_beta;
    else if (beta < min_beta)
      beta = min_beta;
    if ((beta == min_beta || beta == max_beta) && (alfa == min_alfa || alfa == max_alfa)) {
      if (boundarytested++ > 5) break;
    }
  }
  if (period > skip) {
    best_smape *= (count - skip);
    best_smape /= (count - period);
  }
  L_i = best_L_i;
  T_i = best_T_i;
  for (unsigned short i = 0; i < period; ++i) S_i[i] = best_S_i[i];
  double forecast = (L_i + T_i / period) * S_i[count % period];

  printf("{\"smape\":%.17g,\"standarddeviation\":%.17g,\"forecast\":%.17g,"
         "\"period\":%u,\"force\":%s,\"s_i\":[",
         best_smape, best_standarddeviation, forecast, period,
         (autocorrelation > max_autocorrelation) ? "true" : "false");
  for (unsigned short i = 0; i < period; ++i)
    printf("%s%.17g", i ? "," : "", best_S_i[i]);
  printf("]}\n");
  return 0;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr,
            "usage: %s <moving_average|single_exp|double_exp|croston|seasonal> "
            "<params...>\n",
            argv[0]);
    return 2;
  }
  const std::string method = argv[1];
  if (method == "moving_average") return moving_average(argc, argv);
  if (method == "single_exp") return single_exp(argc, argv);
  if (method == "double_exp") return double_exp(argc, argv);
  if (method == "croston") return croston(argc, argv);
  if (method == "seasonal") return seasonal(argc, argv);
  fprintf(stderr, "unknown method: %s\n", method.c_str());
  return 2;
}
