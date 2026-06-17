"""Rust/PyO3 forecast-port parity (Engine track E4).

Diffs each Rust forecast method against a standalone C++ reference that
replicates the corresponding `timeseries.cpp` numeric core verbatim. smape /
standarddeviation / forecast must match within a tight relative epsilon (same
f64 op order); outlier index sets must match exactly. Vectors include
>MAXBUCKETS series — the smapeWeight OOB site.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

frepple_forecast = pytest.importorskip("frepple_forecast")

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
VECTORS = json.loads((HERE / "forecast_vectors.json").read_text())
CXX_SRC = REPO / "tools" / "rust-pilot" / "forecast_reference.cpp"

# Engine defaults (timeseries.cpp:32-36, 416-418).
MA_PARAMS = (5, 4.0, 0.95, 5)  # order, max_deviation, smape_alfa, skip
SE_PARAMS = (0.2, 0.03, 1.0, 4.0, 0.95, 5, 15)  # init/min/max alfa, maxdev, smape_alfa, skip, iters
# init/min/max alfa, init/min/max gamma, maxdev, smape_alfa, skip, iters
DE_PARAMS = (0.2, 0.02, 1.0, 0.2, 0.05, 1.0, 4.0, 0.95, 5, 15)
# min/max alfa, decay_rate, maxdev, smape_alfa, skip, iters
CR_PARAMS = (0.03, 0.8, 0.1, 4.0, 0.95, 5, 15)
# init/min/max alfa, init/min/max beta, gamma, min/max period, min/max autocorr, smape_alfa, skip, iters
SEAS_PARAMS = (0.2, 0.02, 1.0, 0.2, 0.2, 1.0, 0.05, 2, 14, 0.5, 0.8, 0.95, 5, 15)


@pytest.fixture(scope="session")
def cxx_ref():
    env_bin = os.environ.get("FORECAST_CXX_REF_BIN")
    if env_bin and Path(env_bin).exists():
        return env_bin
    out = Path(tempfile.gettempdir()) / "frepple_forecast_reference"
    subprocess.run(["g++", "-O2", "-o", str(out), str(CXX_SRC)], check=True)
    return str(out)


def _history(case):
    if "history" in case:
        return [float(x) for x in case["history"]]
    if "generate_cycle" in case:
        g = case["generate_cycle"]
        return [float(v) for _ in range(g["reps"]) for v in g["cycle"]]
    g = case["generate"]
    return [float(g["base"] + (i % g["mod"])) for i in range(g["n"])]


def _rust(method, history):
    if method == "single_exp":
        return frepple_forecast.single_exponential(history, *SE_PARAMS)
    if method == "double_exp":
        return frepple_forecast.double_exponential(history, *DE_PARAMS)
    if method == "croston":
        return frepple_forecast.croston(history, *CR_PARAMS)
    if method == "seasonal":
        return frepple_forecast.seasonal(history, *SEAS_PARAMS)
    return frepple_forecast.moving_average(history, *MA_PARAMS)


def _cxx_argv(method):
    if method == "single_exp":
        return ["single_exp", *[str(x) for x in SE_PARAMS]]
    if method == "double_exp":
        return ["double_exp", *[str(x) for x in DE_PARAMS]]
    if method == "croston":
        return ["croston", *[str(x) for x in CR_PARAMS]]
    if method == "seasonal":
        return ["seasonal", *[str(x) for x in SEAS_PARAMS]]
    return ["moving_average", *[str(x) for x in MA_PARAMS]]


def _cxx(cxx_ref, method, history):
    res = subprocess.run(
        [cxx_ref, *_cxx_argv(method)],
        input=" ".join(repr(x) for x in history),
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(res.stdout)


def _approx(a, b, rel=1e-9, abs_=1e-12):
    if a == b:  # handles DBL_MAX sentinel + exact zeros
        return True
    return abs(a - b) <= max(rel * max(abs(a), abs(b)), abs_)


@pytest.mark.parametrize("case", VECTORS, ids=lambda c: c["name"])
def test_forecast_parity(case, cxx_ref):
    method = case.get("method", "moving_average")
    history = _history(case)
    out = _rust(method, history)
    ref = _cxx(cxx_ref, method, history)
    smape, stdev, forecast = out[0], out[1], out[2]
    assert _approx(smape, ref["smape"]), f"[{method}] smape rust={smape} cxx={ref['smape']}"
    assert _approx(
        stdev, ref["standarddeviation"]
    ), f"[{method}] stdev rust={stdev} cxx={ref['standarddeviation']}"
    assert _approx(
        forecast, ref["forecast"]
    ), f"[{method}] forecast rust={forecast} cxx={ref['forecast']}"
    if method == "seasonal":
        _, _, _, period, force, s_i = out
        assert period == ref["period"], f"period rust={period} cxx={ref['period']}"
        assert force == ref["force"], f"force rust={force} cxx={ref['force']}"
        assert len(s_i) == len(ref["s_i"]), f"s_i len rust={len(s_i)} cxx={len(ref['s_i'])}"
        for k, (a, b) in enumerate(zip(s_i, ref["s_i"])):
            assert _approx(a, b), f"s_i[{k}] rust={a} cxx={b}"
    else:
        outliers = out[3]
        assert set(outliers) == set(ref["outliers"]), (
            f"[{method}] outliers rust={sorted(outliers)} cxx={sorted(ref['outliers'])}"
        )
