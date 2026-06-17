"""Rust/PyO3 forecast-port parity (Engine track E4, slice 2).

Diffs the Rust `frepple_forecast.moving_average` against a standalone C++
reference that replicates ForecastSolver::MovingAverage::generateForecast +
smapeWeight verbatim. smape/standarddeviation/avg must match within a tight
relative epsilon (same f64 op order); outlier index sets must match exactly.
Includes a >MAXBUCKETS series — the exact OOB-read case.
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

# Engine defaults (timeseries.cpp:32-36, forecast.h).
ORDER, MAXDEV, ALFA, SKIP = 5, 4.0, 0.95, 5


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
    g = case["generate"]
    return [float(g["base"] + (i % g["mod"])) for i in range(g["n"])]


def _cxx(cxx_ref, history):
    stdin = " ".join(repr(x) for x in history)
    res = subprocess.run(
        [cxx_ref, str(ORDER), str(MAXDEV), str(ALFA), str(SKIP)],
        input=stdin,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(res.stdout)


def _approx(a, b, rel=1e-9, abs_=1e-12):
    return abs(a - b) <= max(rel * max(abs(a), abs(b)), abs_)


@pytest.mark.parametrize("case", VECTORS, ids=lambda c: c["name"])
def test_forecast_parity(case, cxx_ref):
    history = _history(case)
    smape, stdev, avg, outliers = frepple_forecast.moving_average(
        history, ORDER, MAXDEV, ALFA, SKIP
    )
    ref = _cxx(cxx_ref, history)
    assert _approx(smape, ref["smape"]), f"smape rust={smape} cxx={ref['smape']}"
    assert _approx(
        stdev, ref["standarddeviation"]
    ), f"stdev rust={stdev} cxx={ref['standarddeviation']}"
    assert _approx(avg, ref["avg"]), f"avg rust={avg} cxx={ref['avg']}"
    assert set(outliers) == set(ref["outliers"]), (
        f"outliers rust={sorted(outliers)} cxx={sorted(ref['outliers'])}"
    )
    # All outputs must be finite (the long >MAXBUCKETS case exercises the
    # smapeWeight clamp / OOB-read site).
    assert all(map(lambda v: v == v, (smape, stdev, avg)))
