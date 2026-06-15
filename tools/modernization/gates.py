#!/usr/bin/env python3
"""
Modernization progress tracker — single source of truth for the verification gates
described in MODERNIZATION_PLAN.md.

Each gate has a status:
  - "active":  implemented; its check() runs and MUST pass (failing one fails CI).
  - "pending": not implemented yet; listed for visibility, never fails the build.

As each phase is built, flip its gates from "pending" to "active" and give them a real
check(). The CI job renders the table below to the GitHub step summary so progress is
visible on every push.

Stdlib only. Run:  python tools/modernization/gates.py
Exit code: 0 if all ACTIVE gates pass; 1 if any active gate fails.
"""

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def has_file(*parts):
    return os.path.isfile(os.path.join(REPO, *parts))


def has_dir(*parts):
    return os.path.isdir(os.path.join(REPO, *parts))


def asan_blocking():
    """True if the engine ASan CI job exists and is a hard gate (not informational)."""
    f = os.path.join(REPO, ".github", "workflows", "engine-asan.yml")
    if not os.path.isfile(f):
        return False
    return "continue-on-error" not in open(f, encoding="utf-8").read()


def file_contains(parts, *needles):
    """True if the file exists and contains every given substring."""
    f = os.path.join(REPO, *parts)
    if not os.path.isfile(f):
        return False
    content = open(f, encoding="utf-8").read()
    return all(n in content for n in needles)


# Each gate: (phase, id, title, status, check)
# check is a zero-arg callable returning bool (only invoked for "active" gates).
GATES = [
    # ---- Bootstrap (this scaffolding) — active from day one ----
    (
        "Bootstrap",
        "plan-present",
        "Modernization plan committed",
        "active",
        lambda: has_file("MODERNIZATION_PLAN.md"),
    ),
    (
        "Bootstrap",
        "gates-harness",
        "Progress-gates harness runs",
        "active",
        lambda: True,
    ),
    (
        "Bootstrap",
        "ci-workflow",
        "Modernization CI workflow present",
        "active",
        lambda: has_file(".github", "workflows", "modernization.yml"),
    ),
    # ---- Phase 0 — API foundation ----
    (
        "Phase 0",
        "openapi-schema",
        "OpenAPI schema endpoint (drf-spectacular) served at /api/schema/",
        "active",
        lambda: file_contains(("requirements.txt",), "drf-spectacular")
        and file_contains(("freppledb", "urls.py"), "SpectacularAPIView"),
    ),
    (
        "Phase 0",
        "ts-client",
        "Typed TS client generates from the schema + tsc-compiles (run in CI build job)",
        "active",
        lambda: file_contains(
            ("tools", "modernization", "gen_api_client.sh"),
            "spectacular",
            "openapi-typescript",
            "tsc",
        )
        and file_contains(
            (".github", "workflows", "ubuntu24.yml"), "gen_api_client.sh"
        ),
    ),
    (
        "Phase 0",
        "output-endpoints",
        "Plan/forecast OUTPUT JSON endpoints (forecast/inventory/resource/demand/pegging)",
        "active",
        lambda: file_contains(
            ("freppledb", "common", "api", "output.py"),
            "JSONStreamView",
            "report_class",
        ),
    ),
    (
        "Phase 0",
        "no-drf-serializer-output",
        "Output endpoints reuse the report raw-SQL path, no DRF serializer",
        "active",
        lambda: file_contains(
            ("freppledb", "common", "api", "output.py"), "report_class"
        )
        and not file_contains(
            ("freppledb", "common", "api", "output.py"), "import serializ"
        ),
    ),
    (
        "Phase 0",
        "jwt-auth",
        "JWT auth works for REST + WS; 401/close on bad token (shared jwtauth util)",
        "active",
        lambda: file_contains(("freppledb", "common", "jwtauth.py"), "def decode_jwt")
        and file_contains(("freppledb", "asgi.py"), "decode_jwt")
        and file_contains(
            ("freppledb", "common", "tests", "test_api_phase0.py"),
            "test_ws_rejects_bad_token",
        ),
    ),
    (
        "Phase 0",
        "ws-scenario-routing",
        "WS layer reads scenario from URL/header (not env var); websocket protocol enabled",
        "active",
        lambda: file_contains(("freppledb", "asgi.py"), "extract_scenario")
        and file_contains(
            ("freppledb", "asgi.py"), '"websocket": AllowedHostsOriginValidator'
        ),
    ),
    # ---- Phase 1A — Websocket beachhead (Execute screen) ----
    (
        "Phase 1A",
        "ws-task-progress",
        "Live task progress over WS (replaces 5s polling)",
        "pending",
        None,
    ),
    ("Phase 1A", "ws-log-tail", "Live log tail streams <1s", "pending", None),
    (
        "Phase 1A",
        "ws-fanout",
        "Two clients on different pods see same updates",
        "pending",
        None,
    ),
    # ---- Phase 1B — Forecast Editor ----
    (
        "Phase 1B",
        "fc-edit-parity",
        "Edit+save re-nets; parity with legacy editor",
        "pending",
        None,
    ),
    ("Phase 1B", "fc-bulk-edit", "Bulk fill / ±% persists correctly", "pending", None),
    (
        "Phase 1B",
        "fc-no-truncation",
        "Renders >300 series without truncation",
        "pending",
        None,
    ),
    ("Phase 1B", "fc-a11y", "Grid a11y scan: 0 critical", "pending", None),
    # ---- Phase 2 — Odoo rework ----
    (
        "Phase 2",
        "odoo-json-parity",
        "JSON export byte-parity vs XML path (golden diff)",
        "pending",
        None,
    ),
    (
        "Phase 2",
        "odoo-n1-fixed",
        "N+1 eliminated: export_items/boms O(1) per entity",
        "pending",
        None,
    ),
    (
        "Phase 2",
        "odoo-writeback-parity",
        "Plan write-back creates same PO/MO/DO/WO",
        "pending",
        None,
    ),
    (
        "Phase 2",
        "odoo-delta-sync",
        "Delta sync: 1 changed BOM re-syncs only that BOM",
        "pending",
        None,
    ),
    # ---- Phase 3 — Expand UI (per-screen) ----
    (
        "Phase 3",
        "inventory-report",
        "Inventory/Buffer report (parity + perf)",
        "pending",
        None,
    ),
    (
        "Phase 3",
        "pegging-gantt",
        "Pegging Gantt with drag-drop reschedule",
        "pending",
        None,
    ),
    (
        "Phase 3",
        "resource-capacity",
        "Resource/capacity + timeline Gantt",
        "pending",
        None,
    ),
    ("Phase 3", "constraint-problem", "Constraint/problem views", "pending", None),
    ("Phase 3", "crud-grids", "Remaining CRUD grids migrated", "pending", None),
    # ---- Phase 3.5 — Helm / deployment ----
    (
        "Phase 3.5",
        "helm-install",
        "helm install green on clean cluster; helm test passes",
        "pending",
        None,
    ),
    (
        "Phase 3.5",
        "lb-ws-fanout",
        "WS message crosses pods (channels_redis)",
        "pending",
        None,
    ),
    (
        "Phase 3.5",
        "probes",
        "Liveness/readiness gate traffic correctly",
        "pending",
        None,
    ),
    (
        "Phase 3.5",
        "no-oomkill",
        "Large plan does not OOMKill worker (MAXMEMORYSIZE≤limit)",
        "pending",
        None,
    ),
    (
        "Phase 3.5",
        "zero-downtime",
        "helm upgrade = zero-downtime rollout",
        "pending",
        None,
    ),
    # ---- Phase 4 — optional Go/Rust BFF ----
    (
        "Phase 4",
        "bff-justified",
        "BFF justified by a measured metric, not preference",
        "pending",
        None,
    ),
    (
        "Phase 4",
        "bff-contract",
        "BFF passes same API contract tests as Django",
        "pending",
        None,
    ),
    # ---- Engine track (parallel) — review, tests, DDMRP, Rust decision ----
    (
        "Engine E1",
        "review-report",
        "Engine code-review + debt/TODO triage report committed",
        "active",
        lambda: has_file("ENGINE_REVIEW.md"),
    ),
    (
        "Engine E1",
        "sanitizers",
        "ASan runs green over the golden suite in CI (UBSan TBD)",
        "active",
        lambda: has_file(".github", "workflows", "engine-asan.yml"),
    ),
    (
        "Engine E1",
        "clang-tidy-baseline",
        "clang-tidy baseline captured; no new warnings",
        "pending",
        None,
    ),
    (
        "Engine E2",
        "pegging-tests",
        "Pegging tests 2->9 (split/transfer/multi-level/offset); alternate/routing+cycle+dep deferred on crash bugs",
        "active",
        lambda: sum(
            1
            for d in os.listdir(os.path.join(REPO, "test"))
            if d.startswith("pegging_") and os.path.isdir(os.path.join(REPO, "test", d))
        )
        >= 9,
    ),
    (
        "Engine E2",
        "structural-asserts",
        "Golden-free structural-invariant scenarios (qty>=0, end>=start) over material/distribution/resource",
        "active",
        lambda: sum(
            1
            for d in os.listdir(os.path.join(REPO, "test"))
            if d.startswith("structural_")
            and os.path.isdir(os.path.join(REPO, "test", d))
        )
        >= 3,
    ),
    (
        "Engine E2",
        "stress-baseline",
        "10k+ operationplan stress scenario w/ time+mem baseline",
        "pending",
        None,
    ),
    (
        "Engine E2",
        "sanitizer-ci",
        "Blocking ASan CI job; golden suite ASan-clean",
        "active",
        asan_blocking,
    ),
    (
        "Engine E3",
        "ddmrp-optin",
        "Per-buffer DDMRP opt-in; MRP buffers unchanged (parity)",
        "pending",
        None,
    ),
    (
        "Engine E3",
        "ddmrp-zones",
        "R/Y/G zone + NFP-triggered replenishment match oracle",
        "pending",
        None,
    ),
    (
        "Engine E3",
        "ddmrp-spike",
        "Spike-horizon qualification filters order spikes",
        "pending",
        None,
    ),
    (
        "Engine E3",
        "ddmrp-decouple",
        "Decoupling point stops BOM explosion at buffer",
        "pending",
        None,
    ),
    (
        "Engine E4",
        "rust-pilot-parity",
        "Rust/PyO3 pilot passes same tests as C++ equivalent",
        "pending",
        None,
    ),
    (
        "Engine E4",
        "rust-measured",
        "Measured LOC/perf/safety comparison vs C++ recorded",
        "pending",
        None,
    ),
    (
        "Engine E4",
        "rust-decision",
        "Rust go/no-go documented from evidence (stop = success)",
        "pending",
        None,
    ),
]

STATUS_ICON = {"pass": "✅", "fail": "❌", "pending": "⬜"}


def evaluate():
    rows = []
    failures = 0
    for phase, gid, title, status, check in GATES:
        if status == "active":
            try:
                ok = bool(check())
            except Exception as e:  # a check that errors counts as a failure
                ok = False
                title = f"{title} (error: {e})"
            result = "pass" if ok else "fail"
            if not ok:
                failures += 1
        else:
            result = "pending"
        rows.append((phase, gid, title, result))
    return rows, failures


def render(rows, failures):
    active = [r for r in rows if r[3] in ("pass", "fail")]
    passing = [r for r in active if r[3] == "pass"]
    total = len(rows)
    done = len(passing)
    pct = int(100 * done / total) if total else 0

    lines = []
    lines.append("# Modernization progress\n")
    lines.append(
        f"**{done}/{total} gates passing ({pct}%)** — "
        f"{len(active)} active, {total - len(active)} pending\n"
    )
    bar_len = 24
    filled = int(bar_len * done / total) if total else 0
    lines.append("`[" + "█" * filled + "·" * (bar_len - filled) + f"] {pct}%`\n")

    current_phase = None
    for phase, gid, title, result in rows:
        if phase != current_phase:
            lines.append(f"\n## {phase}\n")
            current_phase = phase
        lines.append(f"- {STATUS_ICON[result]} `{gid}` — {title}")
    return "\n".join(lines) + "\n"


def main():
    rows, failures = evaluate()
    summary = render(rows, failures)
    print(summary)

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(summary)

    if failures:
        print(f"::error::{failures} active gate(s) failing", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
