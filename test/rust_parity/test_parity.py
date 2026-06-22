"""Rust/PyO3 pilot parity (Engine track E4).

Diffs the Rust `frepple_num` extension against a standalone C++ reference that
replicates src/utils/json.cpp:790-890 verbatim. "agree" vectors must match the
C++ byte-for-byte; "rust_safe" vectors exercise inputs the C++ leaves undefined
(NaN, negative->unsigned) where Rust is defined and safe by construction.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

# The Rust wheel must be installed (maturin); skip cleanly if not (e.g. a plain
# checkout without the pilot built).
frepple_num = pytest.importorskip("frepple_num")

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
VECTORS = json.loads((HERE / "vectors.json").read_text())
CXX_SRC = REPO / "tools" / "rust-pilot" / "cxx_reference.cpp"


@pytest.fixture(scope="session")
def cxx_ref():
    """Path to the compiled C++ reference (env CXX_REF_BIN, else compile here)."""
    env_bin = os.environ.get("CXX_REF_BIN")
    if env_bin and Path(env_bin).exists():
        return env_bin
    out = Path(tempfile.gettempdir()) / "frepple_cxx_reference"
    subprocess.run(["g++", "-O2", "-o", str(out), str(CXX_SRC)], check=True)
    return str(out)


def _rust(op, value):
    fn = getattr(frepple_num, op)
    return fn(str(value)) if op == "parse_long" else fn(float(value))


def _cxx(cxx_ref, cxx_op, value):
    res = subprocess.run(
        [cxx_ref, cxx_op, str(value)], capture_output=True, text=True, check=True
    )
    return int(res.stdout.strip())


@pytest.mark.parametrize("case", VECTORS, ids=lambda c: f"{c['op']}({c['input']!r})")
def test_parity(case, cxx_ref):
    got = _rust(case["op"], case["input"])
    if case["mode"] == "agree":
        expected = _cxx(cxx_ref, case["cxx"], case["input"])
        assert got == expected, f"rust={got} cxx={expected} for {case}"
    else:  # rust_safe: C++ is UB here; assert Rust's defined result
        assert got == case["rust_expected"], f"rust={got} for {case}"
