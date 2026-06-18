# clang-tidy baseline — Engine track E1

Third leg of the E1 static-analysis gate (alongside ASan + UBSan — see
[ubsan-baseline.md](ubsan-baseline.md)). clang-tidy is **parse-only** (no codegen), so it's lighter than
the sanitizer Debug builds and complements them: the sanitizers find UB/memory bugs at *runtime* over the
golden scenarios; clang-tidy finds them *statically*, including on paths the golden data never exercises.

## Configuration (`.clang-tidy`)

Bug-finders only — `clang-analyzer-*` (the path-sensitive analyzer: null derefs, leaks, uninitialised
reads) + high-signal `bugprone-*`. Style / readability / modernize families are **off**: on a mature
C++23 codebase they're thousands of cosmetic hits that bury real findings. Two `bugprone` checks are also
off as high-volume/low-signal here:

- `bugprone-unhandled-self-assignment` — fires on every `operator=` lacking an explicit `this == &other`
  guard. Defensive style, not a bug (84 of 142 findings in the sample).
- `bugprone-exception-escape` — legacy destructors/move ops that *could* throw (26 of 142).

`HeaderFilterRegex: frepple/.*\.h$` keeps findings to frePPLe code (not Python.h / xerces).

## Baseline shape

Configure exports `compile_commands.json` (57 engine TUs). Over a representative sample
(`operationdependency`, `pegging`, `operationplan`, `timeseries`, `solveroperation`, `json`) the
**high-signal** remainder after the two noisy checks are excluded:

| Check | Class | Note |
| --- | --- | --- |
| `clang-analyzer-core.CallAndMessage` | null/uninit call | calls through a possibly-null/uninit pointer — triage first |
| `clang-analyzer-core.uninitialized.Assign` | uninitialised read | reading before init |
| `clang-analyzer-deadcode.DeadStores` | dead store | value computed then overwritten — usually benign, sometimes a logic slip |
| `bugprone-integer-division` | real bug risk | `int/int` fed to a double — precision-loss sites |
| `bugprone-switch-missing-default-case`, `bugprone-copy-constructor-init`, `bugprone-throw-keyword-missing` | misc | low volume |

The **full** current count + per-check breakdown is produced by the `engine-clang-tidy` CI job (step
summary + uploaded `clang-tidy-report` artifact) — not pinned here so the doc doesn't drift.

## Gate posture

`engine-clang-tidy.yml` is **advisory**: it runs the bug-finder check set over `src/`, reports the count +
breakdown in the step summary, and never fails the job (the baseline is non-zero). It runs on PRs into
`modernization` and on push. The tightening to **"no NEW findings on changed files"** (via
`clang-tidy-diff`) lands once the high-signal baseline above is triaged — tracked as **E2**, mirroring how
the UBSan gate went advisory → blocking.
