# Solver spike — optimisation engine for finite-capacity planning (Engine track)

**Question.** frePPLe's shipping MRP solver is a fast *constructive heuristic* (peg demand → supply,
operation by operation). It's strong at feasibility but doesn't optimise a global objective. Could an
**advanced optimisation engine, orchestrated from Rust**, power a *greenfield* finite-capacity / DDMRP
planning mode where that gap matters — and at what integration cost? Same evidence-gated, "stop = success"
playbook as the forecast Rust pilot (`rust-pilot.md`).

**What was built.** `rust/solver-spike/` — a small **capacitated multi-period production-planning LP**
(2 products × 4 periods, one shared capacity-constrained resource) modelled with the **`good_lp`** modelling
layer on the **pure-Rust `microlp` backend**. It solves to optimality and compares against a **lot-for-lot**
plan (what a naive feasibility-first MRP pass produces). One file, ~190 LOC, no C++ dependency.

## Result (`cargo run -p solver-spike`)

```
Lot-for-lot (feasibility-first heuristic, like a naive MRP pass):
  product 1: produce [ 20.0,  20.0,  20.0,  60.0]
  product 2: produce [ 15.0,  15.0,  15.0,  15.0]
  ! capacity OVERLOAD per period: [0.0, 0.0, 0.0, 25.0]
    -> the lot-for-lot plan is INFEASIBLE on the tight resource.

Optimal (capacitated LP, microlp):
  product 1: produce [ 20.0,  20.0,  30.0,  50.0]
  product 2: produce [ 15.0,  25.0,  20.0,   0.0]
  cost: 187.00   (capacity-feasible; pre-builds ahead of the period-4 spike)
```

**Interpretation.** Period-4 demand (60 + 15 = 75) exceeds one period's capacity (50), so lot-for-lot is
simply **infeasible**. The LP finds the cheapest **capacity-feasible** plan: pre-build product 1 (30 in
period 3) and product 2 (25 in period 2) so every period's load ≤ 50, paying a small, *quantified* holding
premium (187 vs the naive-but-infeasible 180 = the price of feasibility the heuristic couldn't even reach).
That trade-off — build-ahead vs capacity — is exactly what a constructive heuristic can't reason about and
an optimiser nails.

## Measurements

| Metric | Finding |
| --- | --- |
| **Integration cost** | One crate, one dependency (`good_lp` + `microlp`); compiles in ~5 s. No C++/CMake, no system solver. The model is ~40 LOC of declarative constraints. |
| **Backend portability** | `good_lp` is a *modelling layer* over CBC / HiGHS / SCIP / Clarabel / microlp. The same model swaps to **HiGHS** (top-tier open-source MILP) behind a feature flag when instances grow — no model rewrite. |
| **Pure-Rust option** | `microlp` solves the LP with **zero non-Rust deps** — the cleanest possible integration for small/medium instances; the only *pure-Rust* path. (HiGHS/CBC/SCIP are C++ — better-maintained solvers driven from Rust, not pure-Rust engines.) |
| **Capability vs the heuristic** | Demonstrated: finds a feasible plan where lot-for-lot overloads, and optimises the build-ahead/holding trade-off. The shipping solver does neither. |
| **Memory safety** | Same story as the forecast pilot — safe Rust orchestration; `#![forbid(unsafe_code)]`-compatible (no unsafe in the spike). |

## Decision (solver-decision)

**Conditional GO — as a greenfield, optional finite-capacity / DDMRP *mode*, NOT a replacement for the MRP
solver.**

- The value is real and the heuristic genuinely can't produce it (feasible capacity-tight plans + explicit
  cost trade-offs). `good_lp` makes the integration cheap and solver-portable (pure-Rust `microlp` now,
  HiGHS for scale), and it's a *new* capability so there's **no parity tax** — unlike the forecast port,
  there's no C++ behaviour to reproduce, just a new objective to optimise.
- **NO-GO on replacing the constructive solver.** It's fast, feasibility-strong on the full BOM/routing
  object graph, and battle-tested; the optimiser is a **complement** for the capacity-tight sub-problem
  (and the natural home for a DDMRP mode), not a wholesale swap. A real deployment also has to map frePPLe's
  rich model (alternates, calendars, lot-size rules, lead times) onto the LP/MILP — a meaningful modelling
  effort this spike deliberately scopes out.

**Recommended next step (if pursued):** lift the toy instance to a real frePPLe sub-scenario (one resource,
its operations + demands over the bucket horizon), model it with `good_lp`, and benchmark the HiGHS backend
on instance sizes that matter — then a go/no-go on shipping a `plan --capacity-optimise` mode behind a flag,
exactly like the forecast `FREPPLE_RUST_FORECAST` pattern.
