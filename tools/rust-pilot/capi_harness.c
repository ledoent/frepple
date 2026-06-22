/* Smoke test for the Rust forecast C ABI (Engine track E4, phase 7): links
 * libfrepple_forecast.a and calls each method through the C boundary, the same
 * way libfrepple will. Proves the FFI works end-to-end without the full engine.
 *   cc -O2 -I tools/rust-pilot capi_harness.c \
 *      rust/frepple-forecast/target/release/libfrepple_forecast.a -o capi_harness
 */
#include <math.h>
#include <stdio.h>
#include "frepple_forecast.h"

int main(void) {
  double history[10] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
  double smape, stddev, forecast;
  size_t outliers[16], olen;
  int fail = 0;

  /* MovingAverage: mean of the last 5 (6..10) = 8.0 */
  double ma[4] = {5, 4.0, 0.95, 5};
  int rc = frepple_moving_average(history, 10, &smape, &stddev, &forecast,
                                  outliers, 16, &olen, ma, 4);
  printf("moving_average: rc=%d forecast=%.6f smape=%.6f\n", rc, forecast, smape);
  if (rc != 0 || fabs(forecast - 8.0) > 1e-9) fail = 1;

  /* SingleExponential: just exercise the boundary + finiteness */
  double se[7] = {0.2, 0.03, 1.0, 4.0, 0.95, 5, 15};
  rc = frepple_single_exponential(history, 10, &smape, &stddev, &forecast,
                                  outliers, 16, &olen, se, 7);
  printf("single_exp: rc=%d forecast=%.6f\n", rc, forecast);
  if (rc != 0 || !isfinite(forecast)) fail = 1;

  /* Seasonal: a clear period-7 cycle should detect period 7 */
  double cyc[70];
  double base[7] = {10, 25, 40, 55, 40, 25, 10};
  for (int i = 0; i < 70; ++i) cyc[i] = base[i % 7];
  double seas[14] = {0.2, 0.02, 1.0, 0.2, 0.2, 1.0, 0.05,
                     2,   14,   0.5, 0.8, 0.95, 5, 15};
  unsigned int period;
  int force;
  double s_i[80];
  size_t s_i_len;
  double l_i, t_i;
  unsigned int cycleindex;
  rc = frepple_seasonal(cyc, 70, seas, 14, &smape, &stddev, &forecast, &period,
                        &force, s_i, 80, &s_i_len, &l_i, &t_i, &cycleindex);
  printf("seasonal: rc=%d period=%u force=%d s_i_len=%zu cycleindex=%u\n", rc,
         period, force, s_i_len, cycleindex);
  if (rc != 0 || period != 7) fail = 1;

  printf(fail ? "CAPI HARNESS: FAIL\n" : "CAPI HARNESS: OK\n");
  return fail;
}
