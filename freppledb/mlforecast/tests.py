#
# Copyright (C) 2026 by frePPLe bv
#
# Permission is hereby granted, free of charge, to any person obtaining
# a copy of this software and associated documentation files (the
# "Software"), to deal in the Software without restriction, including
# without limitation the rights to use, copy, modify, merge, publish,
# distribute, sublicense, and/or sell copies of the Software, and to
# permit persons to whom the Software is furnished to do so, subject to
# the following conditions:
#
# The above copyright notice and this permission notice shall be
# included in all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
# EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
# NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
# LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
# WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#

import unittest

from django.test import SimpleTestCase

try:
    import lightgbm  # noqa: F401
    import mlforecast  # noqa: F401
    import numpy as np
    import pandas as pd

    HAS_DEPS = True
except Exception:
    HAS_DEPS = False


def _seasonal_panel(n_series=8, n_periods=60, freq="MS", seed=0):
    """A synthetic monthly panel with trend + yearly seasonality, all positive."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2018-01-01", periods=n_periods, freq=freq)
    t = np.arange(n_periods)
    rows = []
    for s in range(n_series):
        base = 50 + 20 * s
        trend = 0.5 * (s + 1)
        amp = 15 + 5 * s
        season = amp * np.sin(2 * np.pi * t / 12.0)
        noise = rng.normal(0, 3, n_periods)
        y = np.clip(base + trend * t + season + noise, 0, None)
        for d, val in zip(dates, y):
            rows.append((f"item-{s}", d, float(val)))
    return pd.DataFrame(rows, columns=["unique_id", "ds", "y"])


@unittest.skipUnless(HAS_DEPS, "mlforecast/lightgbm not installed")
class NixtlaForecastTest(SimpleTestCase):
    def test_empty_input_returns_empty_frame(self):
        from freppledb.mlforecast.nixtla import generate_forecasts

        out = generate_forecasts(
            pd.DataFrame(columns=["unique_id", "ds", "y"]), h=6, freq="MS"
        )
        self.assertEqual(list(out.columns), ["unique_id", "ds", "prediction"])
        self.assertEqual(len(out), 0)

    def test_shape_and_non_negative(self):
        from freppledb.mlforecast.nixtla import generate_forecasts

        panel = _seasonal_panel()
        h = 12
        out = generate_forecasts(panel, h=h, freq="MS")

        # h rows per series, correct columns, no negatives.
        self.assertEqual(list(out.columns), ["unique_id", "ds", "prediction"])
        self.assertEqual(set(out["unique_id"]), set(panel["unique_id"]))
        for _uid, sub in out.groupby("unique_id"):
            self.assertEqual(len(sub), h)
        self.assertTrue((out["prediction"] >= 0).all())

    def test_beats_naive_on_seasonal_holdout(self):
        """The global GBM must learn the seasonal signal — i.e. beat a naive
        last-value forecast on a held-out year."""
        from freppledb.mlforecast.nixtla import generate_forecasts

        panel = _seasonal_panel(n_periods=60)
        h = 12
        cutoff = panel["ds"].max() - pd.DateOffset(months=h)
        train = panel[panel["ds"] <= cutoff]
        actual = panel[panel["ds"] > cutoff]

        preds = generate_forecasts(train, h=h, freq="MS")

        merged = actual.merge(preds, on=["unique_id", "ds"], how="inner")
        self.assertGreater(len(merged), 0)
        gbm_mae = (merged["y"] - merged["prediction"]).abs().mean()

        # Naive baseline: repeat each series' last training value.
        last = train.sort_values("ds").groupby("unique_id")["y"].last()
        naive_mae = (actual["y"] - actual["unique_id"].map(last)).abs().mean()

        self.assertLess(gbm_mae, naive_mae)
