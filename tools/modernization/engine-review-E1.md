# Engine review — debt catalog, TODO triage, risk hotspots (Engine track E1)

The first E1 gate item: a structured review of the C++ engine — prioritised debt, the scary-TODO triage,
and a risk-hotspot map (pegging, solver state machine, memory). It pairs with the runtime/static gates
([ubsan-baseline.md](ubsan-baseline.md), [clang-tidy-baseline.md](clang-tidy-baseline.md)) to complete E1.

**Method.** Four parallel surveys (TODO sweep, pegging, solver, memory-safety) followed by **direct
verification of every load-bearing claim** — which corrected several. The corrections are themselves part
of the value (see the last section); treat anything below as verified against the current source, not the
survey output.

## Overall posture

The engine is modern C++23 and the *algorithms* are mature, but it is **pointer-heavy with a hand-rolled
object model welded to CPython**, and its safety net is golden-output diffing with thin coverage in the
riskiest subsystem. Grounded magnitudes (current `src/` + `include/`):

| Signal | Value |
| --- | --- |
| `TODO`/`FIXME`/`XXX`/`HACK` markers | **99** |
| explicit `delete` sites (`src/`) | 122 |
| smart-pointer usages (whole engine) | **16** (i.e. ~all ownership is raw) |
| `Py_INCREF`/`DECREF` hand-management sites | 109 |
| clang-tidy distinct findings (bug-finders) | 54 ([breakdown](clang-tidy-baseline.md)) |
| both sanitizers | **blocking + clean** (ASan, UBSan) |

This is the evidence base for the §1 principle "earn any rewrite decision" — it is a *legitimate* Rust
argument (manual memory + UB surface) **and** a hard one (deep CPython coupling). Neither a "rewrite now"
nor "never" conclusion is supported; the scoped E4 pilot is the right next probe.

## Risk hotspots

### H1 — Solver state machine: fixed recursion bound + manual undo (MED–HIGH)
- **Fixed depth:** `State statestack[MAXSTATES]` with `MAXSTATES = 256` (`include/frepple/solver.h:946,1001`).
  Deep alternate/split/routing descent that overruns throws `RuntimeException` (`solverplan.cpp`) — a
  *handled* failure (a plan dies), not UB/crash, but a hard ceiling with no graceful degradation.
- **Manual push/pop discipline:** `data->state` is a raw pointer into `statestack`; exception cleanup is
  `while (data->state > topstate) data->pop();` (`solverdemand.cpp`). A missed `copy_answer` or a cached
  `State*` used across a pop is UB. Correctness rests on hand-maintained stack discipline across many
  nested `solve()` calls.
- **Undo via CommandManager bookmarks:** rollback must unwind all model mutations; a throw *during*
  rollback (e.g. `CommandDeleteOperationPlan::rollback` re-creating flowloads) leaves partial state — no
  inner guard. Bookmarks aren't RAII.
- **Threading:** per-cluster parallel solve gives each thread its own `SolverData`, but the **shared model
  graph** (Buffer/Resource flowplan timelines) is accessed lock-free on the assumption clusters are
  disjoint; complex cross-item supply can violate that → data-race surface.

### H2 — Memory ownership: recursive destructors + a union-of-heap-iterators (HIGH)
- **`~OperationPlan`** (`operationplan.cpp`) deletes owned sub-plans **and its owner** (`setOwner(nullptr); delete o;`).
  The self-link is broken before the delete, but the recursive owner/child teardown is the single most
  intricate ownership path in the engine — the place a double-free would most plausibly hide.
- **`HasProblems::EntityIterator`** (`src/model/problem.cpp`) is a `union` of five heap-allocated iterator
  pointers tracked by a `type` tag; the destructor deletes the active arm. If a `new …::iterator(...)`
  throws between clearing one arm and assigning the next, the dtor reads a stale `type` and deletes the
  wrong pointer. No RAII / exception guard. **Real, if low-probability.**
- 16 smart pointers across the whole engine ⇒ every other owning relationship is hand-managed.

### H3 — CPython coupling: refcount on the exception path (MED) + separability (LOW for now)
- 109 hand-managed refcount sites. The factory `Object::create` (`include/frepple/utils.h`) does its
  `Py_INCREF(x)` **after** `setField`/`setProperty`, which can throw → an early throw orphans the C++
  object's Python wrapper. Same shape in `PythonData`'s assignment (`src/utils/python.cpp`).
- The model object base carries a `PyObject* dict`; lifetime is Python-refcount-driven via
  `Object::deallocator`. The engine is **not** separable from CPython without reworking the object model /
  C-ABI boundary — directly relevant to scoping any Rust port (favour an isolated leaf, as E4 did, not the
  core).

### H4 — Pegging: thin validation on the fragile cases (MED) — *corrected, see below*
- Pegging traverses the supply graph with a stateful `PeggingIterator` over a thread-local pool. Cycle
  guarding **does exist and is correct** — `set<OperationPlan*> visited` (`model.h:9819`), a default-
  constructed member, checked in `followPegging` (`pegging.cpp:325-327`).
- The real gap is **test coverage of the fragile inputs**: of 12 `test/pegging_*`, **9 carry golden
  `.expect` files and 3 (pegging_4/5/7) are smoke-only** (run-without-crash, no output assertion) — and
  those three are exactly the alternate/routing/infinite-buffer cases. No golden coverage of deep (5+
  level) BOMs or cyclic dependencies.
- **E2 finding — why those 3 can't be golden as-is (verified, not just asserted).** An attempt to capture
  golden baselines for pegging_4/5 confirmed the smoke-only decision is correct and structural, not a
  missing baseline: the pegging report is **deterministic within an environment** (30× identical) but its
  **`operationplans()` iteration order varies *across* environments** — Docker Release vs Debug+ASan **and**
  the GitHub `ubuntu-24.04` runner each order the blocks differently (identical content, reordered). It is
  **single-threaded** (loglevel>0 forces `setMaxParallel(1)`, `solverplan.cpp:840-842`) and
  **PYTHONHASHSEED-independent**, so it's neither a thread race nor Python hash-seed; the order tracks the
  build/stdlib (allocation/pointer-ordering among equivalent operationplans). Proof: golden `.expect`
  captured in two Docker builds **passed locally but failed pegging_4/5 on the GitHub runner**. ⇒ Closing
  H4's golden gap needs a **deterministic tiebreaker**.
- **RESOLVED.** Root-caused to `OperationPlan::operator<` (`operationplan.cpp:1048`), whose final tie-breaker
  for otherwise-identical operationplans was a **pointer comparison** (`return this < &a;`) — self-documented
  as "not reproducible across platforms and runs". It drives the per-operation sorted linked list that
  `operationplans()` iterates, so the order tracked heap addresses (build/ASLR-dependent). Replaced it with a
  **monotonic creation-sequence** tie-breaker (an `atomic<unsigned long>` counter + per-operationplan
  `sequence`, deterministic for the single-threaded reproducible case). Verified: **zero blast radius** (the
  full 97-test golden suite passes unchanged on Release **and** Debug+ASan), and pegging_4/5/7 output is now
  **byte-identical across Release and Debug** — so they are converted to full golden tests.

## Static-analysis cross-reference

The 54 clang-tidy findings concentrate the actionable static signal; the ~10 to triage first
(`clang-analyzer-core.NullDereference` ×1, `…CallAndMessage` ×5, `bugprone-integer-division` ×5,
`…cplusplus.NewDelete` ×4, `…uninitialized.{Assign,Branch}` ×2) overlap H2's manual-memory surface and
should be walked alongside the pegging/solver hotspots in E2. UBSan already retired its findings
(operationdependency null member-call **fixed**; iterator idiom annotated); ASan is clean.

## TODO triage (highlights of the 99)

Prioritised; full sweep available by `grep -rnE 'TODO|FIXME|XXX|HACK' src include`.

**Higher concern (correctness / data shape):**
- `src/solver/solverload.cpp:435,557` — alternate-resource selection is **incomplete**: qualified
  resources are not cost-sorted (only the current one is tried), and on restore the selected resource
  isn't fully reset. Affects plan optimality + state hygiene.
- `src/solver/solverdemand.cpp:657` — `POLICY_INRATIO` demand case is `break; // TODO` — **unimplemented
  policy** silently bypasses the replenishment loop.
- `src/forecast/measure.cpp:1011` — a workaround masks a `removeValue()` vs `setValue(-1)` semantic
  mismatch ("a unit test fails if we remove it") — unresolved inconsistency.
- `src/utils/database.cpp:348` — no automatic reconnect on a dropped DB connection (`PQreset` TODO).

**Disabled / cautionary (not live bugs):**
- `src/solver/operatordelete.cpp:217` — the "**dangerous side effects** … plan quality is better without
  this" shortage-deletion feature is **inside a `/* */` block (disabled)**. Dead code carrying a warning,
  not an active hot-path bug — but a candidate for deletion to stop it misleading readers.

**Performance / design (cold or bounded):**
- `src/model/resource.cpp:715`, `src/model/operationplan.cpp:1424`, `src/solver/operatorforward.cpp:99`
  — setup-time / propagation loops that re-scan more than needed (potential O(n²) on pathological inputs).
- Numerous routing/slack accuracy + code-duplication notes in `operationplan.cpp` / `operation.cpp` /
  `forecast.cpp` — maintainability debt, low correctness risk.

## Corrections to prior assumptions (verification value)

The plan and two sub-surveys carried stale or wrong claims; verified against current source:

| Claim (plan / survey) | Reality |
| --- | --- |
| `solveroperation.cpp:123` "increment a_penalty incorrectly???" — open bug | **Already fixed.** The comment now reads "Previously this loop double-counted … fixed by resetting to beforePenalty/beforeCost each pass" (`:137`, snapshot at `:19-25`). Not an open finding. |
| pegging has "only 2 tests" | **9 golden + 3 smoke-only** (12 `test/pegging_*`). |
| pegging `visited` set "uninitialised → UB / corruption" | **False.** `set<OperationPlan*> visited` is a member object, auto-default-constructed; the cycle guard works. |
| `operatordelete` dangerous code is active | **Disabled** — inside a `/* */` block. |
| `MAXSTATES` overrun = crash / no fallback | Throws a **catchable `RuntimeException`** (handled). |

## E1 status & handoff to E2

E1 gate now complete: review report (this) ✅, ASan+UBSan blocking+clean ✅, clang-tidy baseline ✅. The
prioritised E2 work-list this review hands off:
1. **Pegging golden coverage** for the 3 smoke-only cases + deep-BOM + a cycle case (closes H4, the biggest oracle gap).
2. **Structural-invariant assertions** in the runner (capacity never exceeded, demand ≤ due-or-flagged) — catches H1 class issues line-diffing misses.
3. **Triage the ~10 high-signal clang-tidy findings** (NullDereference / CallAndMessage / NewDelete / uninitialised), then flip clang-tidy to a diff-gate.
4. **Stress scenario** (10k+ operationplans) with solve-time + peak-memory baselines — exercises H1/H2 at scale.
