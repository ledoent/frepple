=========================
Machine Learning Forecast
=========================

This app generates a machine learning forecast. For each forecast record it trains a
model on the demand history and predicts the future over the horizon defined in the
parameters. If a forecast record has too little demand history, or if the model fails
to fit, frePPLe reverts to the statistical forecast methods.

Two engines are available, selected with the parameter
**forecast.MachineLearning_engine**:

``orbit`` (default)
  A per-series Bayesian model based on the Orbit library — one model is fitted per
  forecast record. See https://orbit-ml.readthedocs.io/en/stable/

  Requires the ``orbit-ml`` python package.

``nixtla``
  A single global gradient-boosting model (LightGBM, via the mlforecast library) is
  trained across **all** forecast records at once, using lag, rolling-window and
  calendar features. Learning across series typically improves accuracy on catalogues
  with many short or noisy series. See https://nixtlaverse.nixtla.io/mlforecast/

  Requires the ``mlforecast`` and ``lightgbm`` python packages, and the system library
  ``libgomp1`` (the OpenMP runtime LightGBM links against).

Parameters
----------

==============================  ============================================================
Parameter                       Description
==============================  ============================================================
forecast.MachineLearning_engine  Engine used by this app: ``orbit`` (default) or ``nixtla``.
==============================  ============================================================

The remaining behaviour (calendar, history and future horizon) is controlled by the
standard forecast parameters ``forecast.calendar``, ``forecast.Horizon_history`` and
``forecast.Horizon_future``.
