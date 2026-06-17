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

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <moving_average|single_exp|double_exp> <params...>\n",
            argv[0]);
    return 2;
  }
  const std::string method = argv[1];
  if (method == "moving_average") return moving_average(argc, argv);
  if (method == "single_exp") return single_exp(argc, argv);
  if (method == "double_exp") return double_exp(argc, argv);
  fprintf(stderr, "unknown method: %s\n", method.c_str());
  return 2;
}
