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

"""
Global gradient-boosting demand forecast based on the Nixtla mlforecast library.

Unlike a per-series model (one fit per item), this trains a SINGLE LightGBM
model across the whole demand panel. The model learns cross-series patterns and
can exploit calendar/seasonal features, which typically improves accuracy on
catalogues with many short or noisy series.

The entry point :func:`generate_forecasts` is deliberately free of any
dependency on the frepple planning engine: it takes and returns plain pandas
DataFrames, so it can be unit-tested in isolation. The thin glue that reads
demand history from the engine and writes the baseline back lives in
``commands.py``.
"""

import logging

logger = logging.getLogger(__name__)


# Feature recipe per calendar granularity. Lags/rolling windows are expressed in
# buckets (weeks or months). LightGBM tolerates missing lag values natively, so
# series shorter than the longest lag still contribute their available rows.
_FREQ_CONFIG = {
    "W-MON": {
        "lags": [1, 2, 3, 4, 8, 13, 26, 52],
        "rolling_windows": [4, 13, 52],
        "date_features": ["week", "month", "quarter"],
    },
    "MS": {
        "lags": [1, 2, 3, 6, 12],
        "rolling_windows": [3, 6, 12],
        "date_features": ["month", "quarter"],
    },
}


def _build_model(freq, n_jobs):
    import lightgbm as lgb
    from mlforecast import MLForecast
    from mlforecast.lag_transforms import RollingMean

    cfg = _FREQ_CONFIG.get(freq, _FREQ_CONFIG["MS"])

    regressor = lgb.LGBMRegressor(
        n_estimators=200,
        learning_rate=0.05,
        num_leaves=63,
        min_child_samples=20,
        subsample=0.8,
        colsample_bytree=0.8,
        # Reproducible runs (the planning engine values determinism).
        random_state=0,
        deterministic=True,
        force_row_wise=True,
        n_jobs=n_jobs,
        verbosity=-1,
    )
    return MLForecast(
        models={"lgb": regressor},
        freq=freq,
        lags=cfg["lags"],
        lag_transforms={
            1: [RollingMean(window_size=w) for w in cfg["rolling_windows"]]
        },
        date_features=cfg["date_features"],
    )


def generate_forecasts(panel, h, freq="MS", n_jobs=-1):
    """Fit one global LightGBM model and forecast ``h`` buckets for every series.

    :param panel: DataFrame with columns ``[unique_id, ds, y]`` holding the
        contiguous demand history of every series (one row per bucket). ``ds``
        must be datetime-like and aligned to ``freq``.
    :param h: number of future buckets to forecast (same for all series, as
        frepple drives every forecast from one shared calendar).
    :param freq: pandas offset alias of the calendar bucket — ``"W-MON"`` for a
        weekly calendar, ``"MS"`` for a monthly one.
    :param n_jobs: worker count for LightGBM (``-1`` = all cores).
    :returns: DataFrame ``[unique_id, ds, prediction]`` with ``h`` non-negative
        rows per series, ordered by ``ds``. Empty input yields an empty frame.
    """
    import pandas as pd

    cols = ["unique_id", "ds", "prediction"]
    if panel is None or len(panel) == 0:
        return pd.DataFrame(columns=cols)

    panel = panel[["unique_id", "ds", "y"]].copy()
    panel["ds"] = pd.to_datetime(panel["ds"])
    panel = panel.sort_values(["unique_id", "ds"])

    model = _build_model(freq, n_jobs)
    model.fit(
        panel,
        id_col="unique_id",
        time_col="ds",
        target_col="y",
        static_features=[],
    )

    preds = model.predict(h)
    preds = preds.rename(columns={"lgb": "prediction"})
    # Demand can't be negative; clamp the GBM output at zero.
    preds["prediction"] = preds["prediction"].clip(lower=0.0)
    return preds.sort_values(["unique_id", "ds"])[cols].reset_index(drop=True)
