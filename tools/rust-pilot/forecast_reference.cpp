// Parity authority for the Rust forecast pilot (Engine track E4, slice 2).
// Standalone (no libfrepple): replicates ForecastSolver::MovingAverage::
// generateForecast (src/forecast/timeseries.cpp:294-384) + smapeWeight
// (src/forecast/forecast.h:3041-3054) VERBATIM, with the two
// `new ProblemOutlier(...)` writes replaced by recording the outlier index. The
// Rust port is diffed against this -> a true Rust-vs-C++ parity check.
//
//   NOTE: keep in sync with src/forecast/timeseries.cpp if MovingAverage changes.
//   Build: g++ -O2 -o forecast_reference forecast_reference.cpp
//   Usage: forecast_reference <order> <maxdev> <alfa> <skip>   (history on stdin)
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <vector>

static const int MAXBUCKETS = 500;
static const double ROUNDING_ERROR = 0.000001;  // include/frepple/utils.h:64
static double weight[MAXBUCKETS];

// forecast.h:3051-3054
static inline double smapeWeight(long idx) {
  if (idx < 0) idx = 0;
  if (idx >= MAXBUCKETS) idx = MAXBUCKETS - 1;
  return weight[idx];
}

int main(int argc, char** argv) {
  if (argc < 5) {
    fprintf(stderr, "usage: %s <order> <maxdev> <alfa> <skip>  (history on stdin)\n",
            argv[0]);
    return 2;
  }
  unsigned int order = static_cast<unsigned int>(atol(argv[1]));
  if (order < 1) order = 1;
  const double Forecast_maxDeviation = atof(argv[2]);
  const double Forecast_SmapeAlfa = atof(argv[3]);
  const unsigned long skip = static_cast<unsigned long>(atol(argv[4]));

  // weight table (forecast.h:2627-2629)
  weight[0] = 1.0;
  for (int i = 0; i < MAXBUCKETS - 1; ++i)
    weight[i + 1] = weight[i] * Forecast_SmapeAlfa;

  // history from stdin, then the trailing sentinel (timeseries.cpp:76-92)
  std::vector<double> timeseries;
  double v;
  while (std::cin >> v) timeseries.push_back(v);
  const unsigned int count = static_cast<unsigned int>(timeseries.size());
  timeseries.push_back(0.0);

  // ---- begin verbatim MovingAverage::generateForecast numeric core ----
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
  // ---- end verbatim core ----

  printf("{\"smape\":%.17g,\"standarddeviation\":%.17g,\"avg\":%.17g,\"outliers\":[",
         error_smape, standarddeviation, avg);
  for (size_t k = 0; k < outliers.size(); ++k)
    printf("%s%ld", k ? "," : "", outliers[k]);
  printf("]}\n");
  return 0;
}
