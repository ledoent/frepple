/* C ABI for the Rust forecast methods (Engine track E4, phase 7). Links against
 * libfrepple_forecast.a (cargo `staticlib`). Scalars are returned via out-pointers;
 * variable-length outputs go into a caller buffer up to `*_cap`, with the true
 * length via `*_len`. All functions return 0 on success.
 *
 * Params are passed as a small f64 array `p` (length `np`), in this order:
 *   moving_average:     [order, max_deviation, smape_alfa, skip]
 *   single_exponential: [init_alfa, min_alfa, max_alfa, max_deviation, smape_alfa, skip, iters]
 *   double_exponential: [init_alfa, min_alfa, max_alfa, init_gamma, min_gamma, max_gamma,
 *                        max_deviation, smape_alfa, skip, iters]
 *   croston:            [min_alfa, max_alfa, decay_rate, max_deviation, smape_alfa, skip, iters]
 *   seasonal:           [init_alfa, min_alfa, max_alfa, init_beta, min_beta, max_beta, gamma,
 *                        min_period, max_period, min_autocorr, max_autocorr, smape_alfa, skip, iters]
 */
#ifndef FREPPLE_FORECAST_H
#define FREPPLE_FORECAST_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define FREPPLE_FORECAST_SCALAR_SIG                                            \
  const double *history, size_t count, double *out_smape, double *out_stddev, \
      double *out_forecast, size_t *out_outliers, size_t out_cap,             \
      size_t *out_len, const double *p, size_t np

int frepple_moving_average(FREPPLE_FORECAST_SCALAR_SIG);
int frepple_single_exponential(FREPPLE_FORECAST_SCALAR_SIG);
int frepple_double_exponential(FREPPLE_FORECAST_SCALAR_SIG);
int frepple_croston(FREPPLE_FORECAST_SCALAR_SIG);

int frepple_seasonal(const double *history, size_t count, const double *p,
                     size_t np, double *out_smape, double *out_stddev,
                     double *out_forecast, uint32_t *out_period,
                     int32_t *out_force, double *out_s_i, size_t s_i_cap,
                     size_t *out_s_i_len);

#ifdef __cplusplus
}
#endif
#endif
