# Rust/PyO3 pilot — evidence + decision (Engine track E4)

**Question (MODERNIZATION_PLAN.md §E4):** pilot one isolated module in Rust via PyO3, prove parity
with the C++, measure LOC/perf/safety, and document a go/no-go — "stop = success".

**What was ported.** The JSON number-conversion kernel of `src/utils/json.cpp` —
`getLong` (790–815), `getUnsignedLong` (817–841), `getInt` (865–890): the `double → clamped integer`
and `string → integer` (`atol`) logic. This is the **exact site of the inverted-bound bug** fixed
earlier in the C++ (`< LONG_MIN` had been `> LONG_MIN`, which made `getLong` return `LONG_MIN` for
ordinary doubles). Implementation: `rust/frepple-num/` (a PyO3 extension built with maturin),
decoupled from the C++/CMake build.

## Parity (rust-pilot-parity)

`test/rust_parity/test_parity.py` diffs the Rust extension against a standalone C++ reference
(`tools/rust-pilot/cxx_reference.cpp`) that copies the json.cpp branches **verbatim** — a true
Rust-vs-C++ diff, not a hand-authored expectation. **24/24 vectors pass** locally and in CI:

- **19 "agree" vectors** (normal values, truncation toward zero, out-of-range saturation, string
  parses) match the C++ reference byte-for-byte — including the regression case `clamp_to_long(5.0) → 5`
  (the C++ bug returned `LONG_MIN` here).
- **5 "rust_safe" vectors** exercise inputs the C++ leaves **undefined**, where Rust is defined:
  `NaN → 0` (C++ `static_cast<long>(NaN)` is UB), `±inf → i64::MIN/MAX`, and `negative → unsigned`
  saturates to `0` (the C++ has no lower clamp and wraps to a huge value).

## Measurements (rust-measured)

| Metric | C++ (`json.cpp` getters) | Rust (`frepple-num`) |
| --- | --- | --- |
| LOC (the three getters / the four ported fns) | 98 | 35 |
| Clamp kernel — the bug site | ~4 hand-written lines per getter (`if d > MAX … else if d < MIN …`) | **1 line** (`x as i64`, saturating) |
| `unsafe` blocks in the conversion logic | n/a (all C++ is unsafe by nature) | **0** (compile-enforced by `#![forbid(unsafe_code)]`) |
| Float→int out-of-range | manual clamp (got it wrong once) | saturating by language definition |
| `NaN` handling | UB (`static_cast`) | defined (`→ 0`) |
| Perf | in-process, a few instructions | ~39 ns/call **including** the Python→Rust FFI hop; the arithmetic itself is a few instructions, same as C++ |

Notes on fairness: the C++ getters are larger partly because they dispatch the full JSON tagged union
(8 type cases); the Rust port covers the numeric kernel that carried the bug. Perf is **not** the
differentiator — this is a leaf conversion, not a hot path, and both compile to a handful of
instructions; the ~39 ns is dominated by the Python FFI boundary (irrelevant here). The headline is
**safety**, not speed.

## Safety / maintainability assessment

- The specific shipped bug (inverted clamp) and two latent UB sinks (`NaN` cast, negative→unsigned
  wrap) are **all impossible or defined** in safe Rust — for free, via saturating `as` casts.
- `#![forbid(unsafe_code)]` makes "zero unsafe in our logic" a **compile-time guarantee**, not a
  review promise. The only `unsafe` is inside the vetted `pyo3` FFI glue — unavoidable for *any*
  Python extension, and a tiny audited surface vs. the C++ engine which is unsafe in its entirety.
- `cargo test` runs the logic with **zero Python/toolchain dependency** (pyo3 is an optional,
  feature-gated dep), so the numeric core is unit-tested in isolation in ~5 s.

## Build / integration cost

- maturin wheel, **no CMake/Cargo coupling** (Option A). Standalone CI job
  (`.github/workflows/rust-pilot.yml`): `cargo test` + build the C++ ref + maturin build + parity
  `pytest`, ~1–2 min, independent of the slow engine build and the staging deploy.
- A Rust toolchain in the *engine image* (~150 MB) is **deferred** — only needed if we ship the wheel,
  which is a "go"-only fast-follow.

## Decision (rust-decision)

**Conditional GO — for targeted Rust on isolated, numeric, safety-critical leaf modules; NO-GO for a
wholesale engine rewrite.**

The evidence is one-sided on the question that motivated the pilot: Rust eliminates *this exact class*
of memory/UB bug by construction, at a tiny LOC and a low, decoupled integration cost, with no
meaningful perf trade-off on this kind of code. That justifies continuing **incrementally**: the next
evidence step is the larger, still-isolated `src/forecast/` SMAPE math (~1.1k LOC, the other fixed
memory-bug site) ported behind the same maturin/PyO3 pattern and validated against the existing
forecast golden tests, with the C++ remaining the shipping path until that port reaches golden-parity.

A full rewrite of the deeply C++-coupled engine (object graph, embedded CPython, solver) is **not**
justified by this evidence — the cost/risk is enormous and most of the engine is not the bug-prone,
isolatable, numeric code where Rust's guarantees pay off cleanly. "Targeted, evidence-gated, leaf-first"
is the supported path; "rewrite the engine" is not.
