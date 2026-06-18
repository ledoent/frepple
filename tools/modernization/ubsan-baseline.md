# UBSan baseline — Engine track E1

**Goal (MODERNIZATION_PLAN.md §E1):** run the already-wired sanitizers over the golden test suite,
document findings by severity, establish a gate. ASan is done (`engine-asan.yml`, blocking, the golden
suite is ASan-clean). This is the **UndefinedBehaviorSanitizer** half.

## How to reproduce

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Debug -DFREPPLE_SANITIZER=undefined
cmake --build build --target frepple-main -j
# run a golden test directly (runtest.py PIPEs+discards child stderr unless -d):
UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=0" \
  FREPPLE_HOME=bin LD_LIBRARY_PATH=bin bin/frepple -validate test/forecast_11/forecast_11.xml
# or the whole suite, streamed:
UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=0" ./test/runtest.py -d
```

`CMakeLists.txt` selects the sanitizer for the Debug build via `-DFREPPLE_SANITIZER=` (`address` default
= the existing ASan gate; `undefined` = UBSan; `address,undefined` = both). The UBSan build **excludes
`-fsanitize=vptr`** — see Finding 1.

## Baseline run

96 pure-engine (type-2) golden tests run directly under the executable (the 1 type-1 dir, which needs
Django/DB, skipped). The full suite incl. type-1 runs in CI (`engine-ubsan.yml`). UBSan output is
**memory-safe** (ASan is separately clean); these are *undefined-behaviour* diagnostics — code the
optimiser is permitted to miscompile, not live memory corruption.

## Findings (by severity)

### Finding 1 — `vptr`: custom MetaClass RTTI is incompatible with `-fsanitize=vptr` — **NOISE / by-design — EXCLUDED**
Sites: `include/frepple/utils.h:6252, 6359, 6363, 6372, 6469, 6678, 6691, 3358` (and others), reported as
*"member call / downcast on address which does not point to an object of type `Buffer`/`Resource`/`Flow`/
`Operation`/`Demand`/…"*. frePPLe does not use C++ polymorphism for its model objects; it has a
hand-rolled type system (`MetaClass`/`MetaCategory`, downcast by type tag). UBSan's `vptr` check verifies
the C++ dynamic type via the vtable and cannot see frePPLe's tag-based identity, so **every** model
downcast trips it. These are not bugs. **Decision:** `-fno-sanitize=vptr` in the UBSan build
(`CMakeLists.txt`), documented here. Re-enabling vptr would require reworking the object model onto
standard RTTI — out of scope, and the cast sites are exercised billions of times in production.

### Finding 2 — iterator `operator*` forms a reference to null at `end()` — **LOW (idiom), accepted (baseline)**
Sites: `include/frepple/timeline.h:293` (`const Event& operator*() const { return *cur; }`, 58 hits) and
`include/frepple/model.h:8667` (`Problem& operator*() const { return *iter; }`, 58 hits). When the iterator
is at `end()` / default-constructed, `cur`/`iter` is null and `*cur` *binds a reference to null* — UB by
the letter, but the value is never dereferenced (`operator++` guards `if (cur)`, and callers compare
against `end()` before deref). This is the **same UB the standard library has** for `*v.end()`. Fires in
nearly every test because timelines/problem-lists are iterated everywhere. **Decision:** accepted for the
baseline; it is why the gate is advisory (below). E2 can retire it by annotating the two `operator*`
with `__attribute__((no_sanitize("null")))` (g++ has no runtime suppressions file) or refactoring the
end-sentinel — both are header churn deferred out of the baseline pass.

### Finding 3 — `OperationDependency::set{Operation,BlockedBy}` null member-call — **MEDIUM (real) — FIXED**
Sites: `src/model/operationdependency.cpp:99` and `:122`. Symmetric bug: when only one side of a
dependency is set, the code called `blockedby->addDependency(this)` / `oper->addDependency(this)` on a
**null** receiver. It "worked" (and ASan stayed clean) only because `Operation::addDependency` early-returns
on an incomplete dependency (`if (!dpd->getOperation() || !dpd->getBlockedBy()) return;`) *before* touching
the null receiver's members — but forming a member call on a null `this` is UB regardless, and the
optimiser may assume `this != nullptr`. UBSan caught `:122` directly (1 test); `:99` is its mirror image,
unexercised by the current golden data but the identical defect. **Fix:** guard both calls
(`if (oper) …` / `if (blockedby) …`). Provably behaviour-preserving — `addDependency` no-ops in exactly
the guarded case — so it removes the UB without changing any output. Golden suite stays byte-identical.

## Gate posture

`engine-ubsan.yml` runs the full golden suite under UBSan as an **advisory** gate: `halt_on_error=0`, so a
finding prints + is summarised in the job's step-summary but does **not** fail the job. It still fails on a
genuine (non-UB) test break (`pipefail`) and on any build/link regression of the UBSan configuration.

This mirrors how `engine-asan.yml` was introduced — informational until its 8 crashes were fixed, then
flipped to blocking. UBSan flips to `halt_on_error=1` (blocking) once Finding 2 is retired (Finding 1
excluded, Finding 3 fixed), leaving zero expected findings. That tightening is **E2** work.

## Status

| Finding | Class | Severity | Disposition |
| --- | --- | --- | --- |
| 1. vptr on MetaClass RTTI | by-design false positive | noise | `-fno-sanitize=vptr` (excluded) |
| 2. iterator `operator*` null-binding | UB idiom (STL-parallel) | low | accepted; gate advisory; retire in E2 |
| 3. operationdependency null member-call | real latent UB | medium | **fixed** (`:99`, `:122`) |

ASan: blocking + clean (`engine-asan.yml`). UBSan: advisory baseline established (this doc).
