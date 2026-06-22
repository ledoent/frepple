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

Configure exports `compile_commands.json` (57 engine TUs). A header finding is reported once **per
including TU**, so the raw line count (~182) over-states reality; deduped by `path:line:col`+check the
baseline is **54 distinct findings**. Breakdown (full `src/`, the check set below):

| Check | n | Class | Triage |
| --- | --- | --- | --- |
| `clang-analyzer-deadcode.DeadStores` | 16 | dead store | usually benign; a few may be logic slips |
| `bugprone-switch-missing-default-case` | 10 | missing default | low risk |
| `clang-analyzer-core.CallAndMessage` | 5 | null/uninit call | **triage** — call through a possibly-null/uninit arg |
| `bugprone-integer-division` | 5 | precision loss | **triage** — `int/int` fed to a double |
| `clang-analyzer-cplusplus.NewDelete` | 4 | manual-memory misuse | **triage** — use-after-free / double-free shapes |
| `clang-analyzer-security.FloatLoopCounter` | 2 | float loop counter | review |
| `bugprone-suspicious-string-compare` / `-empty-catch` / `-copy-constructor-init` | 2 ea | misc | low |
| `clang-analyzer-core.NullDereference` | 1 | **null deref** | **triage first** |
| `clang-analyzer-core.uninitialized.{Assign,Branch}` | 1 ea | uninitialised read | **triage** |
| `clang-analyzer-security.insecureAPI.strcpy`, `bugprone-unused-raii`, `-throw-keyword-missing` | 1 ea | misc | low |

The live count + breakdown is also emitted by the `engine-clang-tidy` CI job (step summary, distinct vs
raw) and the uploaded `clang-tidy-report` artifact. The numbers above are a snapshot for orientation; CI
is the source of truth. The ~10 **triage** findings (NullDereference, CallAndMessage, integer-division,
NewDelete, uninitialised) are the E2 work-list before the gate tightens to "no new findings".

## Gate posture

`engine-clang-tidy.yml` is **advisory**: it runs the bug-finder check set over `src/`, reports the count +
breakdown in the step summary, and never fails the job (the baseline is non-zero). It runs on PRs into
`modernization` and on push. The tightening to **"no NEW findings on changed files"** (via
`clang-tidy-diff`) lands once the high-signal baseline above is triaged — tracked as **E2**, mirroring how
the UBSan gate went advisory → blocking.
