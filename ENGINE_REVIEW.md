# frePPLe Engine Code Review (E1)

**Scope:** C++ engine (`src/solver`, `src/model`, `src/forecast`, `src/utils`, `include/`) +
the Django/Python layer (`freppledb/`). Method: parallel subsystem reviews, highest-impact claims
re-verified against source. All findings cite `file:line`.

**Headline:** This review found **~12 concrete, evidence-backed defects** — including several
**reachable in normal production paths** — plus a clear map of the fragile areas. The engine is a
*battle-tested but fragile* asset: correct enough to ship, with real bugs that are mostly **small,
isolated, fixable in place**. This directly validates doing the review (and test hardening) **before**
any rewrite — and it gives the Rust decision real evidence instead of vibes.

---

## Severity dashboard

| Subsystem | Critical | High | Medium | Low |
|---|---|---|---|---|
| Solver (`src/solver`) | 2 | 4 | 5 | 5 |
| Model + Pegging (`src/model`) | 2 | 4 | 4 | 3 |
| Forecast (`src/forecast`) | 2 | 2 | 3 | 2 |
| Utils + CPython (`src/utils`) | 2 | 4 | 4 | 2 |
| Django (`freppledb/`) | 2 | 7 | 7 | 4 |

---

## Immediate-fix queue (isolated, high-value, low-risk — do these first)

These are localized patches with outsized payoff; none require architectural change. Ordered by ROI:

1. **`PythonData(result)` refcount leak** — `src/utils/python.cpp:1026-1063` (+ `utils.h:2646-2648`).
   `PythonFunction::call()` returns a *new* ref; `PythonData(const PyObject*)` unconditionally `INCREF`s
   with no matching `DECREF` → **+1 leaked ref per Python callback, inside the solve loop** → unbounded
   memory growth in long-running services. *The single highest-value memory fix.* Fix: steal the ref.
2. **`weight[]` out-of-bounds read** — `src/forecast/forecast.h:3039` / used `timeseries.cpp:355,516,781,1142`.
   `static double weight[500]` indexed by history-bucket count, which **routinely exceeds 500** with the
   default 10-yr horizon (≈520 weekly / 3650 daily). Silent OOB read corrupts SMAPE weights → wrong
   method selection. **Production-reachable.** Fix: size to series length / clamp.
3. **GIL leaked on exception** — `src/utils/python.cpp:172-224, 227-260`. `PyGILState_Ensure` not
   released on the throw paths in `execute()`/`initialize()` → **process-wide deadlock** on next acquire.
   Fix: RAII GIL guard.
4. **`OperatorDelete::create` refcount leak** — `src/solver/operatordelete.cpp:79`. A stray `Py_INCREF(s)`
   the sibling `SolverCreate::create` deliberately omits (solverplan.cpp:114-117). One leak per construct.
   Fix: delete the line.
5. **`EntityIterator` copy-ctor UB** — `src/model/problem.cpp:357-372`. Calls `this->~EntityIterator()`
   on a brand-new object → reads uninitialized `type`, `delete`s a garbage pointer → heap corruption.
   Fix: remove the destructor call.
6. **JWT path never checks `user.is_active`** — `freppledb/common/middleware.py:246-287` + the
   `user_can_authenticate` override (`auth.py:96`). **Deactivated users with a valid token still
   authenticate.** Off-boarding silently broken for API clients. Fix: enforce `is_active`.
7. **`a_penalty` double-count** — `src/solver/solveroperation.cpp:50-123`. The author's TODO
   ("doesn't this loop increment a_penalty incorrectly???") is a **real bug**: the capacity retry loop
   accumulates penalty without the snapshot/restore the alternate-selection path does correctly
   (solveroperation.cpp:1559,1629). Causes non-deterministic wrong alternate selection. Fix: bracket
   `a_penalty`/`a_cost` around the loop.
8. **JSON inverted double→long bound** — `src/utils/json.cpp:803-808,878-883`. `else if (data_double >
   LONG_MIN) return LONG_MIN;` → any in-range positive double returns `LONG_MIN`. Silent wrong integers.
9. **`setMaximumCalendar` iterator-after-erase** — `src/model/buffer.cpp:477-482`. `delete &(*(oo++))`
   reads the just-nulled `next` → loop stops after the first deletion. Use the capture-advance idiom
   already at buffer.cpp:403-409.
10. **Cache eviction use-after-free window** — `src/utils/cache.cpp:449-459`. `flush()` runs with the
    lock released; needs an under-lock refcount recheck before `expire()` deletes.

Each maps to a gate-able regression test; collectively they're the seed of the E2 test corpus.

---

## Solver (`src/solver`)

Architecture: single-threaded-per-cluster recursive descent; per-thread `CommandManager` + 256-deep
`State` stack (no shared mutable planning state between worker threads — **concurrency model is sound**).
Correctness rests entirely on disciplined save/restore of a shared mutable `State` struct and ~8
interdependent bool flags (`forceLate`, `noRestore`, `delayed_reply`, …) across deep recursion + retry
loops. Most findings are failures of that discipline.

- **C1 `a_penalty` double-count** (`solveroperation.cpp:123`) — real bug; see fix #7 above.
- **C2 OperatorDelete refcount leak** (`operatordelete.cpp:79`) — see fix #4.
- **H1** single `loopcounter` shared between the supply-retry and max-early loops splits the retry
  budget unpredictably → safety stock under-planned on deep BOMs (`solverbuffer.cpp:807-943`).
- **H2** iterator invalidation across `solve()`-induced timeline mutation; mitigated by manual rewind,
  fragile (`solverresource.cpp:94-259`, author TODO at :542).
- **H3** `forceLate`/`noRestore` flag coupling within one retry loop; dead-init then overwrite signals
  drift (`solveroperation.cpp` ↔ `solverresource.cpp:64,75,425,529`).
- **H4** two outer planning loops have no hard iteration cap (rely on date advancement) → potential hang
  on degenerate data (`solverdemand.cpp:224`, `solverbuffer.cpp:478-570`); contrast the guarded loop at
  `solverbuffer.cpp:44`.
- **M1** monolithic functions: `solve(ResourceBuckets)` ~548 LOC, `solve(Buffer)` ~736, `solve(Demand)`
  ~632 — where the flag-coupling bugs concentrate.
- **M3** `POLICY_INRATIO` demand groups silently `break` without enforcing the ratio — a stub posing as
  a supported policy (`solverdemand.cpp:656`).
- *Refuted during verification:* the suspected double-`pop()` at `solverdemand.cpp:626/663` is **not** a
  bug (the second drain is a no-op after normal completion).

**Verdict:** fragile-but-correct, load-bearing core. **Right subsystem for an eventual Rust port, wrong
way to start** — the algorithm is under-specified by anything except this code, so a naive port would
faithfully reproduce H1/H3. Sequence: fix C1/C2 in place → build the regression corpus → port leaf
solvers (`solverflow`/`solverload`/`solverresource`) last-to-first, leaving the demand orchestrator last.

---

## Model + Pegging (`src/model`) — the pointer-heaviest area

Hand-rolled raw-pointer object graph: intrusive linked lists, bidirectional owner⇄child deletion,
dual-owned flowplans, a thread-local placement-`new` pool, `union`-of-iterator-pointers with manual
`new`/`delete`. **No smart pointers in the ownership model** — lifetime is managed by naming convention
and "null the back-pointer before deleting" comments.

- **C1 EntityIterator copy-ctor UB** (`problem.cpp:357-372`) — see fix #5.
- **C2** bidirectional owner/child `delete` recursion; cycle broken only by manually nulling back-pointers
  first; combined with three `delete this` sites in `activate()` → double-free if any path forgets
  (`operationplan.cpp:1149-1190, 840-866`).
- **H1** `MemoryObjectList::operator=` assigns *through* a reference member — cannot rebind; copy-assigns
  a `MemoryPool` with default shallow copy → latent double-free landmine (`utils.h:7173-7183`).
- **H2** `PeggingIterator::visited` set **never cleared** between traversals and omitted from `operator=`
  → silent wrong pegging quantities when `OperationDependency` edges exist (`model.h:9817`,
  `pegging.cpp:323-339,68-77`).
- **H3** `setMaximumCalendar` iterator-after-erase (`buffer.cpp:477-482`) — see fix #9.
- **H4** `followPegging` does `dynamic_cast<FlowPlan*>(...)->...` with **no null check** inside
  quantity-driven unbounded scans → null-deref crash if a non-flowplan event falls in the window
  (`buffer.cpp:594,634,690,748`).
- **M2** `OperationPlan` is a god object (~220 methods, 13 pointer members across 5 linked structures) —
  concentrates the memory-safety risk.

**Coverage gap (the scary part):** pegging has **only 2 tests**, both linear purchase→make→delivery.
Untested: split, alternate, routing sub-step, **dependency edges (would expose H2)**, transfer-batch,
maxlevel truncation — i.e. *the most pointer-dangerous code is the least tested.*

**Verdict:** genuinely dangerous and **the strongest Rust candidate in the codebase** — every C1/H1/H2/H3/H4
here is a bug class Rust eliminates by construction (enums, non-reseatable refs, borrow checker forbids
mutate-while-iterating). Pragmatic near-term: fix the five bugs + add ASan + backfill the 5 pegging tests.

---

## Forecast (`src/forecast`) — the Rust-pilot candidate

Hand-rolled moving-avg / single+double exponential (Holt / Holt-Winters) / Croston with an analytic
Marquardt optimizer. Math largely sound, with self-doubts.

- **C (mem) `weight[]` OOB** (`forecast.h:3039`) — see fix #2. Production-reachable.
- **C (mem) `short` bucket index** unchecked at ~20 subscript sites (`forecast.h:774`, `forecast.cpp:401…`).
- **H** null `PyDict_GetItemString` deref in `setValuePython2` (`forecast.cpp:1577`).
- **A1** outlier seed uses uninitialized std-dev (`timeseries.cpp:451,675`, author TODO); seasonal method
  has no outlier detection (`timeseries.cpp:1005`).
- **M** `leaf` memoization data race — unlocked `const_cast` write while solver runs threaded
  (`forecast.cpp:171`); non-finite exprtk results flow into SQL unchecked (`measure_compute.cpp:267`).

**Isolation:** the **numeric kernel is Python-free** (netting, hierarchy match, disaggregation, the fits,
exprtk eval) — but `Forecast`/`ForecastBucket` **inherit `Demand`**, and the code is welded to
`Plan::instance()`, `Measures::` globals, the Postgres `ForecastData` persistence, and MetaClass+CPython
registration. **Pilot scope = carve out the flat-array numeric kernel** (`(dates[], values[][], params)
→ values[]`); keep `forecast.cpp` as the marshalling adapter. Fix the two OOB bugs *first* so the Rust
port starts from a bounds-safe spec.

---

## Utils + embedded CPython (`src/utils`)

- **C `PythonData(result)` callback leak** (`python.cpp:1026`) — see fix #1.
- **C GIL leaked on exception** (`python.cpp:172-260`) — see fix #3.
- **C `transcodeUTF8` shared-buffer + unlocked encoder init** → truncation + race (`xml.cpp:37-56`).
- **H JSON file buffer not NUL-terminated** → heap over-read (`json.cpp:144-159`); **inverted double→long
  bound** (`json.cpp:803`, fix #8); **cache eviction UAF** (`cache.cpp:449`, fix #10); **`Duration::parse`
  integer overflow** (`date.cpp:165-267`).

**MetaClass reflection** (`utils.h`): one `MetaField` cleanly multiplexes **XML+JSON+Python** via the
PyObject-free `DataValue`/`Serializer` abstractions — so the *value plane is separable* (good news). The
*bad news* is `class Object : public PyObject` (`utils.h:3021`): every engine object embeds the CPython
header and carries reflection intrusively, so any in-process-shared-graph rewrite needs a C++ shim per
type. A Python-boundary-only rewrite avoids reimplementing MetaClass but pays per-call marshalling.

---

## Django / Python layer (`freppledb/`)

Mature, disciplined (no `pickle`/`eval` on untrusted input, list-form subprocess — no shell injection,
**streams** heavy report output, `executesql` correctly superuser-gated). But the **token-auth + async
surfaces** and the **task worker** have real defects a new API would inherit.

- **C1** JWT path skips `is_active` (`middleware.py:246`, `auth.py:96`) — see fix #6.
- **C2** SQLi antipattern in `ForecastPlanAPI.raw()` — laundered by `strftime` today, fragile
  (`forecast/serializers.py:142`).
- **H1** `count(*)` uncached on every grid page — a cache was *removed* in commit e7ea943e1; top perf fix
  (`report.py:1612`).
- **H2** task pickup not atomic (no `select_for_update`) → duplicate execution (`runworker.py:256`).
- **H3** crashed subprocess force-reported as "Done" — `exitcode` never inspected (`runworker.py:168`).
- **H4/H5** `@csrf_exempt` on destructive `APITask` + no CSRF/Origin check on the async consumers, which
  reflect arbitrary `Origin` into CORS (`execute/views.py:294`, `input/services.py:144`,
  `forecast/services.py:130`).
- **H6** find-or-update lets `add_*`-only users overwrite existing rows (`common/api/serializers.py:60`).
- **H7** `reportmanager` runs unrestricted raw SQL for non-superusers (`reportmanager/views.py:706`).
- **Maintainability:** `report.py` (4,352 LOC) is a coherent god-class — keep, extract upload/count.
  `input/serializers.py` (2,094 LOC) is the worst offender — ~30 near-identical 4-class blocks with
  duplicated MO/WO write logic that has **already diverged** (`WorkOrderdetailAPI:1808` wrong serializer;
  doubled `batch` field `:1919/1921`). Factor before the new API reuses it.

**Top 3 to fix before building the new API:** (1) token-auth surface (C1,H4,H5); (2) atomic + crash-honest
worker (H2,H3); (3) count caching + the add/overwrite permission gap (H1,H6).

---

## Cross-cutting conclusions

1. **The review paid for itself.** ~12 concrete bugs, several production-reachable (the `weight[]` OOB,
   the per-callback refcount leak, the inactive-user JWT hole). Most are small, isolated fixes.
2. **Rust decision — now evidence-based:** the **model/pegging graph** is unambiguously where a borrow
   checker would have prevented real, shipped bugs; the **forecast numeric kernel** is the lowest-risk
   *pilot*. But the correct order is **fix-in-place → build the test corpus → pilot**, not rewrite-first.
3. **Test coverage is the gating constraint (feeds E2):** the strong 196k-line golden oracle has a
   gaping hole exactly at the dangerous code (pegging: 2 tests; no C++ unit tests; no ASan in CI;
   Python bindings barely tested). Closing this is the precondition for *any* rewrite and is valuable
   regardless.

### Recommended next actions
- **Open the immediate-fix queue as tracked work** (10 items above) — quick, high-value, low-risk.
- **E2 test hardening:** backfill the 5 pegging scenarios, add structural assertions, wire ASan/UBSan CI.
- **Then** reassess the Rust pilot (E4) against a green sanitizer baseline + the new corpus.
