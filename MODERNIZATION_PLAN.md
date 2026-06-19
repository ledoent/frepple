# frePPLe Modernization Plan

**Goal:** Modern, fast, event-driven UX. Replace the EOL AngularJS/jqGrid frontend with
Next.js, expose a clean API + websocket/event layer, and rework the Odoo integration —
**without rewriting the C++ solver or forecast engines.**

**Status:** Draft v1 — planning artifact. Update as phases complete.

---

## 1. Guiding principles

1. **Keep the crown jewels — but earn any rewrite decision with evidence, don't assume it.**
   The C++ solver and forecast engine are mature (modern C++23), performance-critical, and welded to
   an embedded CPython interpreter via a MetaClass reflection layer — not separable. They are wrapped,
   not rewritten *today*. BUT the engine is genuinely pointer-heavy (~70 manual `new`/`delete`, raw-
   pointer graph traversal in solver/pegging) with real memory-safety surface and a few correctness
   TODOs — a legitimate Rust argument. The decision is deferred to the **Engine track** (§7): review →
   harden tests (the rewrite oracle) → run the already-wired ASan/UBSan → pilot ONE module in Rust/PyO3
   → let data decide. A full-engine rewrite's best case is still "identical behavior, years later"; a
   *scoped* pilot (greenfield DDMRP solver, or the isolated forecast module) is how you evaluate Rust
   without betting the proven MRP core.
2. **Keep Django as orchestration + data layer.** Modern deps (DRF 3.15, channels 4, allauth 65),
   multi-scenario DB isolation, and fast raw-SQL report queries are years of plumbing worth keeping.
   The web layer is *not* the bottleneck — I/O and N+1 queries are.
3. **Strangler-fig, not big-bang.** New Next.js UI runs side-by-side with the old UI, screen by
   screen. Old screens retire only after the new one passes its verification gate.
4. **API-first.** One clean contract serves the new frontend *and* the reworked Odoo connector.
   Build it once.
5. **Measure before optimizing.** Every performance claim gets a before/after number at its gate.

### Known constraints / flags (from code audit)
- **Django is a frePPLe fork** (`github.com/frePPLe/django`, branch `frepple_8.3`). Security
  updates lag upstream. Understand *why* it was forked before deepening reliance — tracked as a risk.
- **Confirmed N+1s** in the Odoo connector (`outbound.py`): per-product `product.supplierinfo`
  query (self-documented `# TODO it's inefficient`), per-BOM line/subproduct/operation queries.
- **Websockets are staged but OFF**: `WebsocketService` consumer is commented out in `asgi.py`.
  Channels/Daphne are installed; JWT token middleware exists; a Follower/Notification subscription
  model exists. The event stack is ~60% built, not greenfield.
- **DRF-serializer slowness** is the one real "Python is slow" risk — avoided by serving large
  result sets via the existing raw-SQL → `StreamingHttpResponse` path, not DRF serializers.

---

## 2. Target architecture

```
        KEEP                         HARDEN                        REPLACE
  ┌────────────────┐         ┌───────────────────────┐      ┌──────────────────┐
  │  C++ solver    │◀──embed─│   Django + DRF        │◀────▶│   Next.js app    │
  │  C++ forecast  │         │   - REST (CRUD)       │ HTTP │   - TanStack      │
  └────────────────┘         │   - SQL→JSON (output) │  +   │     Table/Query   │
                             │   - Channels (WS)     │  WS  │   - Recharts/D3v7 │
                             │   - Token auth        │      │   - Gantt         │
                             └──────────┬────────────┘      └──────────────────┘
                                        │ JSON/REST  (replaces XML-over-XMLRPC)
                                  ┌─────┴──────┐
                                  │    Odoo    │
                                  └────────────┘

  Optional later: thin Go/Rust BFF in front of Django for WS fan-out / hot read paths.
```

**Auth model:** JWT bearer tokens (middleware already exists) for the SPA + websockets;
keep session/CSRF for the legacy UI during co-existence.

---

## 3. The API specification (Phase 0 detail)

Three surfaces. All versioned under `/api/v1/`.

### 3.1 REST — master data (CRUD)
Mostly exists today as DRF `frePPleListCreateAPIView` / `RetrieveUpdateDestroy`. Work = fill gaps
+ schema + consistent auth/pagination/filtering.

| Resource | Path | Status |
|---|---|---|
| item, location, customer, supplier | `/api/v1/input/{resource}/` | ✅ exists |
| buffer, resource, skill, calendar, calendarbucket | `/api/v1/input/{resource}/` | ✅ exists |
| operation, operationmaterial, operationresource | `/api/v1/input/{resource}/` | ✅ exists |
| demand, itemsupplier, itemdistribution | `/api/v1/input/{resource}/` | ✅ exists |
| forecast, measure | `/api/v1/forecast/{resource}/` | ✅ exists |
| **operationplan (PO/MO/DO/WO) CRUD** | `/api/v1/input/operationplan/` | ⚠ verify edit semantics |

Conventions: cursor pagination, `?filter[...]`, `?fields=`, `?scenario=` (DB selector),
`ETag`/`If-None-Match`, RFC-7807 error bodies.

### 3.2 REST — plan/forecast OUTPUT (the gap to close)
The valuable data (forecast results, inventory projection, pegging) is currently trapped in the
jqGrid markup path. Expose it as JSON **by reusing the existing raw-SQL queries** (NOT DRF
serializers — dodges the serializer-slowness risk). Stream large grids via `StreamingHttpResponse`.

| Endpoint | Source today | Returns |
|---|---|---|
| `GET /api/v1/output/forecast/` | forecast `OverviewReport` SQL | item×loc×cust × buckets × measures |
| `GET /api/v1/output/inventory/` | buffer report CTE (`buffer.py`) | on-hand, safety stock, produced/consumed, days-of-cover |
| `GET /api/v1/output/resource/` | resource report SQL | available/load/setup/utilization% per bucket |
| `GET /api/v1/output/demand/` | demand report SQL | orders, planned, backlog, constraints |
| `GET /api/v1/output/pegging/{demand}/` | pegging recursive query | supply-chain tree + Gantt rows |
| `GET /api/v1/output/constraint/`, `/problem/` | out_constraint / out_problem | violation lists + weights |
| `GET /api/v1/output/kpi/` | kpi view | fill rate, on-time %, utilization |

Common query params: `?buckets=day|week|month`, `?start=&end=`, `?filter[...]`, `?scenario=`.

### 3.3 Websocket + events (re-enable + finish the staged stack)
Channel auth: JWT via subprotocol or `?token=`.

| Channel | Purpose | Backed by |
|---|---|---|
| `ws /api/v1/ws/tasks/` | Live task progress (replaces 5s polling). Pushes `{taskid, status, pct, message}` on change. | `Task.status` (already stores `'45%'`) |
| `ws /api/v1/ws/tasks/{id}/log/` | Live log tail (replaces full-file download). | task logfile |
| `ws /api/v1/ws/notifications/` | Event feed for followed objects. | existing Follower/Notification model |
| `ws /api/v1/ws/plan/` | Plan-changed broadcast after solve (cache-invalidate / refetch signal). | runplan completion signal |

Event envelope (all channels):
```json
{ "type": "task.progress|task.log|notification|plan.changed",
  "ts": "ISO-8601", "scenario": "default", "data": { ... } }
```
HTTP fallbacks: SSE for log tail, existing `/execute/api/status/` polling for tasks.

### 3.4 Cross-cutting
- **OpenAPI schema** via `drf-spectacular` → typed TypeScript client codegen for Next.js
  (no hand-written, drift-prone types).
- **Auth:** JWT (existing `TokenMiddleware`); document refresh + scope.
- **Versioning:** `/api/v1/`; additive changes only within a major.

---

## 4. Phased roadmap with verification gates

Each phase has an explicit, testable gate. A phase is "done" only when its gate passes.
Phases 1A/1B can run in parallel after Phase 0.

### Phase 0 — API foundation
**Build:** OpenAPI schema (`drf-spectacular`); fill CRUD gaps; the output JSON endpoints
(§3.2) over existing SQL; JWT auth wired for API + WS; published TS client.
**Why first:** both frontend tracks *and* the Odoo rework consume this.
**Verification gate:**
- [ ] `GET /api/v1/schema/` returns a valid OpenAPI 3 doc; TS client generates with 0 errors.
- [ ] Every §3.2 output endpoint returns data matching the legacy report for the same filter
      (golden-file diff on a seeded demo dataset).
- [ ] Large inventory grid streams (no full buffering) and beats the legacy jqGrid JSON
      response time — record ms before/after.
- [ ] JWT auth round-trip works for both a REST call and a WS connect; unauthorized = 401/403.
- [ ] No DRF serializer on any output endpoint (grep gate) — SQL path only.

### Phase 1A — Websocket beachhead: Execute / plan-run screen
**Build:** Re-enable `WebsocketService` in `asgi.py`; `ws/tasks/` + `ws/tasks/{id}/log/`
channels; minimal Next.js page that launches a plan and shows **live** progress + log tail.
**Why:** smallest surface that proves the whole event stack end-to-end (auth → channel → React).
**Verification gate:**
- [ ] Launch `runplan` from the Next.js page; progress bar advances from WS pushes (not polling).
- [ ] Log tail streams within <1s of lines being written.
- [ ] Kill the worker mid-run → UI shows Failed state from the channel.
- [ ] Two browsers see the same live updates (channel fan-out works).
- [ ] Token-expired connection is rejected and reconnects cleanly.

### Phase 1B — First real screen: Forecast Editor
**Build:** Next.js Forecast Editor against `/api/v1/output/forecast/` (read) +
existing `ForecastService`/`FlushService` async path (write). Modern editable pivot
(TanStack Table), Recharts/D3v7 charts, bulk edit (copy/fill/±%), outlier highlighting,
remove the top-300 truncation.
**Why:** highest-value self-contained screen; forecasting is the priority; async backend exists.
**Verification gate:**
- [ ] Edit a forecast cell → save → re-net runs → grid reflects new `forecastnet` (parity with
      legacy editor on the same edit).
- [ ] Bulk fill/±% across a selection persists correctly (spot-check DB rows).
- [ ] Renders >300 series without truncation; scroll/filter stays responsive (record frame time
      vs. legacy).
- [ ] Outliers visibly flagged; one-click exclude updates the series.
- [ ] Accessibility: keyboard nav + screen-reader labels on grid (axe scan, 0 critical).

### Phase 2 — Odoo integration rework
**Build:** Replace monolithic XML-over-XMLRPC with batched JSON/REST (reuse Phase-0 contract);
fix the confirmed N+1s with set-based prefetch; split into (a) scheduled master-data sync and
(b) on-demand order write-back; move to **delta** sync (changed records since last run).
**Verification gate:**
- [ ] Full export produces byte-equivalent plan inputs vs. the XML path (golden diff on demo DB).
- [ ] N+1s eliminated: query count for `export_items` + `export_boms` drops from O(N) to O(1)
      per entity type — record query counts before/after (Django `assertNumQueries` / profiler).
- [ ] Plan write-back creates the same PO/MO/DO/WO records as today (count + field parity).
- [ ] Delta sync: changing 1 BOM re-syncs only that BOM, not the full model.
- [ ] End-to-end sync wall-time recorded before/after on a representative dataset.

### Phase 3 — Expand the new UI (value order)
**Build, one screen at a time, each its own mini-gate:**
1. **Inventory/Buffer report** — reuse `/api/v1/output/inventory/`; sticky headers, virtualized grid.
2. **Demand Pegging Gantt** — the ambitious one: interactive Gantt with **drag-drop rescheduling**
   (write back via operationplan API, preview downstream impact).
3. **Resource/Capacity** — utilization + a resource-timeline Gantt.
4. **Constraint/Problem** — violation lists + (new) impact/conflict view.
5. **Order summaries (MO/PO/DO)** + remaining **CRUD grids** (mechanical).
**Per-screen gate (template):**
- [ ] Data parity with legacy screen on seeded dataset (golden diff).
- [ ] Performance ≥ legacy (record load/interaction ms).
- [ ] Core workflow completes (e.g., Gantt: reschedule an MO, see it persist + downstream update).
- [ ] a11y scan clean; legacy screen flagged for retirement.

**Delivered — Inventory / Demand / Resource (read pivots):** the three reporting
screens ship as `PivotScreen` over enriched `/api/output/{inventory,demand,resource}/`.

**Delivered — Problems / Constraints + Orders (flat lists):** the violation-list and
order-summary screens ship as a reusable `TabListScreen` + `RecordTable` + `useRecordList`
(flat records, not pivots). Problems/Constraints toggle over new `/api/output/{problem,constraint}/`
(`JSONStreamView`, Django-tested); Orders toggle MO/PO/DO over the input DRF lists
(`/api/input/{manufacturingorder,purchaseorder,distributionorder}/`). The **Orders grid is
inline-editable** (Phase 3 CRUD): status pills, per-row edit of status/dates/quantity →
`PATCH`, delete with inline confirm → `DELETE`, optimistic + toast + reload; executed orders
(completed/closed) are locked. *Create* needs an operation/item picker — the one documented
follow-on. Covered by Playwright smoke + a11y (0 critical) + engine-backed CRUD specs
(edit-persist, delete).

**Delivered — Demand Pegging Gantt, slice D1 (read-only):** pick a sales order →
trace its supply chain on a dated Gantt. Backend `PeggingJSONView`
(`freppledb/common/api/output.py`) enriches the pegging report with a `window`
header (horizon + due/current markers) the bare stream drops; data stays
byte-identical under `data` (Django data-parity test). Frontend `app/pegging/`
+ `lib/pegging.ts` (parse + geometry, unit-tested) render an HTML/CSS positioned-bar
Gantt — *not* SVG, so the drag-reschedule slice drops in without re-plumbing
geometry. Covered by Playwright smoke + a11y (0 critical) + an engine-backed
render spec. Sequenced **read-only first**; the ambitious parts are split out:
- **D2 — reschedule write-path (delivered):** drag a bar → `PATCH /api/input/<ordertype>/<ref>/`
  via `authedFetch` (type→endpoint map, editability lock, optimistic + snap-back). Engine-backed E2E.
- **D3 — downstream highlight + re-plan loop (delivered):** a reschedule flags the affected downstream
  chain (`downstreamChain`, the moved op + its ancestors toward the delivery — unit-tested) and offers an
  in-place **Re-plan now** (`useReplan` launches `runplan`, waits over the task ws, re-fetches the peg).
  Deliberately *not* a precise client-side ghost-bar simulation (it can't match the engine + would mislead);
  the re-plan gives the authoritative downstream. Engine-backed E2E for the full loop.

### Phase 3.5 — Deployment: Helm chart + load-balanced images
**Context — data/state model (from code audit):**
- **PostgreSQL is the single source of truth.** Multi-DB router for scenarios. *No Redis today;
  no key-value store.* Cache = per-process `LocMemCache` (not shared). Sessions = `signed_cookies`
  (stateless — good for LB). Channel layer = **none → in-memory default (won't fan out across pods)**.
- **The live plan lives in the C++ engine's RAM in the worker process** (`MAXMEMORYSIZE` limit).
  This is the key constraint: **the solver is stateful and vertically scaled — never round-robin
  load-balanced.** Web traffic scales horizontally; planning scales by queue throughput.

**Build — chart topology:**
- `postgresql` — StatefulSet or external managed PG (source of truth).
- `web` — Deployment + HPA, stateless Daphne/ASGI; HTTP liveness/readiness probes; signed-cookie
  sessions mean no shared session store needed.
- `nextjs` — Deployment + HPA, stateless.
- `worker` — Deployment, **NOT load-balanced**; large memory request/limit; runs `runworker`/`runplan`;
  scale replicas by queue depth, not by traffic.
- `redis` (**NEW**) — required for `channels_redis` (WS fan-out across web pods); also shared cache
  (replace LocMem) + optional task broker. **Never a system of record — Postgres stays authoritative.**
- Image: multi-stage build, non-root, OCI labels; align `MAXMEMORYSIZE` with the pod memory limit.

**Verification gate:**
- [ ] `helm install` on a clean cluster comes up green with zero manual steps; `helm test` passes.
- [ ] `web` scales to N replicas; a websocket message published from one pod reaches a client
      connected to a *different* pod (proves `channels_redis` fan-out).
- [ ] Liveness/readiness probes correctly gate traffic: a failing pod is removed from the
      Service endpoints; a slow-start pod doesn't receive traffic until ready.
- [ ] Worker pod liveness reflects the heartbeat (kill the process → pod restarts).
- [ ] A plan run survives a `web`-pod rolling update (planning is decoupled from web lifecycle).
- [ ] Memory: a large plan does not OOMKill the worker (MAXMEMORYSIZE ≤ pod limit, verified).
- [ ] `helm upgrade` performs a zero-downtime rollout of `web`/`nextjs`.

**Delivered (staging review env) — `deploy/helm/frepple/`:**
- Live at **https://frepple-staging.hz.ledoweb.com** (k3s `hetzner-ledo`, ns `frepple-staging`):
  modernized Execute + Forecast screens on the **real C++ engine**. TLS via cert-manager
  `letsencrypt-prod`; one nginx ingress mirrors `e2e/nginx.conf` routing (`/ws`,`/forecast/detail`,
  `/flush`→asgi; `/api`,`/data`,`/static`,`/execute/launch`→web; `/`→SPA).
- Images built on the **ledoent x86 ARC runners** (`.github/workflows/deploy-staging.yml`, plain
  `docker build` on the dind sidecar) → `ghcr.io/ledoent/frepple-{app,frontend}:<sha>`. Test-new-images
  loop: push → workflow → `helm upgrade --set image.tag=<sha>` → rollout (verified twice).
- Postgres = shared CNPG `shared-db` (superuser, frepple creates `frepple0/1/2`). Redis in-release for
  channels fan-out. App is **single-replica/Recreate** (web+asgi co-located sharing an `emptyDir` log dir,
  since the cluster has only RWO storage) — the HPA/multi-pod gate above is the documented v2 (needs RWX
  + a separated worker).
- TLS-behind-proxy correctness: `FREPPLE_SECURE_PROXY_SSL_HEADER` + `FREPPLE_CSRF_TRUSTED_ORIGINS` set so
  Django trusts the https origin; the SPA sends `X-CSRFToken` on the runplan launch POST.
- Verified: all 6 Playwright specs (smoke + a11y + **live-progress**: Run plan → engine → WS → terminal
  state) green against the live URL; cert Ready; `/data/login/`,`/execute`,`/forecast` → 200.
- **Rust forecast flipped ON (helm REVISION 7, PR #12, Engine track E4):** the staging `frepple-app`
  image builds with `FREPPLE_RUST_FORECAST=ON`, so all five forecast methods run in Rust in-engine —
  **Rust is the forecast source of truth on staging.** The deployed `libfrepple.so` embeds the five
  `extern "C"` wrappers and `runtest.py forecast_1..11` pass byte-exact *inside the deployed pod* (11/11).
  Default stays OFF elsewhere; reversible by the flag. See `tools/modernization/rust-pilot.md` Phase 7.

### Phase 4 (optional) — Go/Rust BFF
**Only if measured need.** Thin gateway in front of Django for WS fan-out at scale or hot
read-path offload. **Never the solver.**
**Verification gate:**
- [ ] A concrete metric (WS connections, p99 read latency) exceeds Django's comfortable range
      *before* this phase starts — i.e., justified by data, not preference.
- [ ] BFF passes the same API contract tests as Django (drop-in).

---

## 5. Cross-phase verification infrastructure (build early)
- **Seeded demo dataset** — deterministic fixture so every "parity" gate is reproducible
  (the frepple demo/sample data is a starting point).
- **Golden-file harness** — capture legacy report/endpoint output, diff new output against it.
- **Query-count + timing harness** — `assertNumQueries` + the `frepple_profiler.py` pattern
  (already written) for before/after numbers on every perf claim.
- **Side-by-side deploy** — old UI and Next.js served together so users can A/B and fall back.

---

## 6. Open questions — RESOLVED (2026-06-13)

### Q1. Why was Django forked? → **RESOLVED: low risk, de-fork is realistic**
The fork (`frePPLe/django`, branch `frepple_8.3`) is **stock Django 4.2 LTS** (current LTS),
tracking the official `4.2.x` stable branch. The real divergence is **tiny**: only 6 frePPLe
commits, ~11 files, ~100 lines — small patches to admin templates/widgets, `auth/decorators.py`,
`core/management/commands/migrate.py`, `db/models/base.py`, `fields/related.py`, `forms/models.py`.
These almost certainly exist to support the **multi-database scenario model** (cross-DB migrate +
foreign-key handling).
- **It is NOT a deep architectural fork of a custom framework.** It's modern Django + a thin patch set.
- **The actual liability:** the fork is **~80 commits behind** the latest 4.2.x security releases —
  they sync manually and lag upstream CVE patches.
- **Implication:** Don't treat Django as a rewrite blocker. Two tractable paths: (a) re-base on the
  latest 4.2.x to close the security lag, or (b) reduce the ~100 lines to app-level overrides /
  monkey-patches and run **stock upstream Django**. *Action item: attempt to isolate the patches into
  an app and run unforked Django — likely feasible.*

### Q2. Community vs Enterprise boundary → **RESOLVED: everything local is MIT**
All three repos (app, Odoo connector, kencove deployment) are **MIT-licensed** Community Edition.
- Dual-license model: Community = MIT; Enterprise = separate proprietary product (**not in this code**).
- **No license-key checks, no feature gating, no runtime license validation** in the code. The
  `license.xml` files are inert placeholders ("Community Edition users").
- Forecast, MLForecast, SQL report manager, wizard, **Odoo connector** are ALL MIT and present here.
  The "Enterprise only" strings are documentation comments for features that live in a separate
  proprietary product (e.g. safety-stock/reorder export extras) — absent from this code.
- **Implication:** Full freedom to modernize, fork, build closed-source derivatives, and redistribute,
  **provided** the MIT notice + "Copyright frePPLe bv" attribution is preserved. No CLA found.

### Q3. Scenario model in the API → **RESOLVED: path-prefix routing; WS needs a fix**
Scenarios = **separate PostgreSQL databases** (`default`, `scenario1`, … — not schemas), registered
in a `common_scenario` table in the default DB. Routing today:
- **HTTP/WSGI:** scenario is a **URL path prefix** (`/scenario1/...`); `MultiDBMiddleware` strips it
  and sets `request.database`; `MultiDBRouter` routes all ORM ops via thread-local request context.
- **Auth is global, access is per-scenario:** users live in the default DB; `User.databases` (an
  ArrayField) gates which scenarios they can reach (404 if not allowed). JWT encodes the **user only**,
  not the scenario. Permissions (is_superuser/is_active) can differ per scenario.
- **⚠ Websockets/ASGI differ:** the ASGI `TokenMiddleware` picks the DB from a **`FREPPLE_DATABASE`
  env var** (one ASGI process per scenario), NOT from the URL. This conflicts with a single
  load-balanced web deployment serving all scenarios.
- **API design decision:** use **`/api/v1/<scenario>/...`** path routing (reuses existing middleware).
  **Required fix for the Helm/LB goal:** make the ASGI/websocket layer read the scenario from the URL
  path (or a header / WS subprotocol) instead of the env var, so one `web` deployment can serve all
  scenarios. *Folded into Phase 0 (auth/routing) + Phase 3.5 (deployment).*

### Q4. Target deployment / Next.js origin → **RESOLVED: same-origin + JWT**
**Decision (user, 2026-06-13): single ingress, same origin, pure JWT auth.**
```
Ingress (one host)
  /          → nextjs Deployment
  /api/v1/*  → web (Django/ASGI)
  /ws/*      → web (Django/ASGI)
```
- Auth = `Authorization: Bearer <JWT>` for both REST and websockets. **No cookies, no CSRF, no CORS.**
- Stateless web pods (no server session store) → clean horizontal scaling, LB-friendly.
- **Implications baked into the plan:**
  - Phase 0: standardize on JWT for all API + WS auth; drop reliance on session/CSRF for the new SPA
    (legacy UI keeps sessions during co-existence). Scenario stays in the URL path (`/api/v1/<scenario>/`).
  - Phase 3.5 (Helm): one ingress with the three path routes above; web + nextjs are separate stateless
    Deployments behind it.

---

## 7. Engine track (parallel to the UI/API phases) — RESOLVED direction (2026-06-15)

A separate workstream focused on the C++ engine: code quality, test hardening, DDMRP, and an
evidence-based Rust decision. Runs **in parallel** with Phases 0–3 (different skill set, no shared
critical path). Sequenced E1 → E4.

### Context from the engine audit
- **C++ is modern (C++23) and clean-ish**, but **pointer-heavy**: ~70 manual `new`/`delete`, raw-pointer
  graph traversal in `src/model/pegging.cpp` + `src/solver/solveroperation.cpp`; deep embedded-CPython
  coupling (`src/utils/python.cpp`, MetaClass reflection) — **not separable** from Python.
- **Scary correctness TODOs** in the hot path (e.g. `solveroperation.cpp:123` "doesn't this loop
  increment a_penalty incorrectly???"; `operatordelete.cpp` "dangerous side effects").
- **Test oracle exists but has a hole:** 82 golden scenarios → ~275 `.expect` files → ~196k lines of
  expected output (strong), BUT **pegging has only 2 tests**, no C++ unit tests, no stress/perf/negative
  tests, Python bindings barely tested. ASan/UBSan are already wired in CMake but not run in CI.
- **Licensing confirmed (skeptical re-audit):** the repo is the **complete, ungated MIT Community
  Edition**. `edition` is a cosmetic display string; **no runtime license/edition gating** in Python
  or C++; paid features (2FA, advanced Odoo export, quoting) are a **separate absent codebase**, not a
  gate. (A few connector methods like `export_forecasts` carry "Enterprise only" *comments* but nothing
  enforces them.)
- **DDMRP:** frePPLe is classic full-BOM-explosion push MRP (single `solver_mrp`, `solverplan.cpp:64`).
  Partial DDMRP primitives already exist — **decoupled lead time** (`buffer.cpp:1300 getDecoupledLeadTime`,
  a real head start) and a decoupling-point flag (`model.h:5220 IP_DATA`, used only for pegging today).
  Missing: buffer zones (R/Y/G), ADU, Net Flow Position, qualified/spike demand, dynamic buffer
  adjustment. Adding a hybrid `solver_ddmrp` mode is a **feature project (~a quarter)**, not a rewrite.

### E1 — Thorough code review + sanitizer baseline
**Build:** Structured review of engine + Django (debt catalog, the scary TODOs triaged); run the
already-wired **ASan/UBSan** over the golden test suite; run clang-tidy/analyzer; document findings.
**Verification gate:**
- [x] Review report committed: `tools/modernization/engine-review-E1.md` — 99-marker TODO triage,
      risk-hotspot map (solver state machine, memory ownership, CPython coupling, pegging), clang-tidy/UBSan
      cross-reference, and **verification corrections** (the `a_penalty` "bug" is already fixed; pegging has
      9 golden tests not 2; the pegging `visited` cycle-guard is sound; the operatordelete "dangerous"
      block is disabled). Hands a prioritized work-list to E2.
- [x] ASan + UBSan run green across the golden scenarios. **Both blocking + clean** — `engine-asan.yml`
      (the 8 Calendar UB crashes fixed earlier) and `engine-ubsan.yml` (vptr excluded for the MetaClass
      RTTI; one real null member-call fixed in `operationdependency.cpp`; the iterator `operator*`
      null-binding idiom marked `FREPPLE_NO_SANITIZE_NULL`). Findings in `tools/modernization/ubsan-baseline.md`.
- [x] clang-tidy baseline captured (advisory gate `engine-clang-tidy.yml`, bug-finder check set in
      `.clang-tidy`); `tools/modernization/clang-tidy-baseline.md`. "No new findings" tightening → E2.

### E2 — Test hardening (the rewrite-safety oracle)
**Build:** Fill the pegging hole (multi-level BOM, circular supply, coalescence, alternate flows);
add **structural assertions** to the test runner (capacity never exceeded, demand≤due-or-flagged);
add a stress scenario (10k+ operationplans) with time/memory baselines; add negative/infeasible cases.
**Verification gate:**
- [ ] Golden pegging coverage — **blocked by a confirmed engine finding** (`engine-review-E1.md` H4): the 3
      smoke-only tests (pegging_4/5/7) can't be byte-exact golden as-is because their pegging-report ordering
      is environment-dependent (verified: deterministic per-environment but reorders across Docker
      Release/Debug and the GitHub runner; single-threaded; PYTHONHASHSEED-independent — an attempt to convert
      pegging_4/5 passed in Docker but failed on the GitHub runner). Needs a **deterministic tiebreaker** (a
      stable secondary sort in the pegging iterator, or a content-keyed sort in each test's output block)
      before these 3 + a ≥3-level BOM + a cycle case can become golden.
- [~] Structural-invariant assertions — **mechanism delivered**: a reusable `test/invariants.py` checker +
      the `test/invariants_1` test that solves a fully-constrained combined model and asserts SOUND invariants
      (operationplan temporal/quantity sanity; no resource overload under a capacity constraint; a finite
      buffer goes negative only if a material-shortage problem is flagged). It is a **boolean pass/fail oracle**
      (deterministic `INVARIANTS_OK` output), so unlike byte-exact golden it is robust to the environment-
      dependent ORDER (H4) — verified to pass under **both Release and Debug+ASan** and to **fail (exit≠0) on an
      injected capacity overload** (4 overloads caught). Finding: the "obvious" invariants (demand met-by-due,
      buffer never negative) **false-positive on valid plans** (legitimate late/short/over deliveries; WIP
      buffers) — only the conservative set above is universally sound. Still open: wrapping more scenarios
      (a runtest.py hook that runs the checker after each test) toward "every golden scenario".
- [ ] One stress scenario with recorded solve-time + peak-memory baseline (regression-gated).
- [x] Sanitizer CI job added and green on the branch (ASan + UBSan blocking, clang-tidy advisory — E2 slice 1).

### E3 — DDMRP mode (hybrid with classic MRP)
**Build:** Data model (buffer zone profiles, ADU config, spike horizon — via new fields/attributes);
ADU + Net Flow Position calculation; a `solver_ddmrp` path with per-buffer opt-in; reuse the existing
`getDecoupledLeadTime`. Classic-MRP buffers and DDMRP buffers coexist in one model.
**Verification gate:**
- [ ] Per-buffer `ddmrp` opt-in routes to the DDMRP solver; non-opted buffers unchanged (MRP parity preserved).
- [ ] Golden DDMRP scenarios: zone (R/Y/G) transitions + NFP-triggered replenishment match hand-computed expectations.
- [ ] Spike-horizon qualification demonstrably filters order spikes from the buffer signal.
- [ ] Decoupling point stops BOM explosion at the buffer (vs. classic full explosion) — verified on a multi-level model.

### E4 — Rust pilot + decision (evidence-based)
**Build:** Pilot ONE isolated module in Rust via **PyO3** — preferred candidate is the **new DDMRP
solver** (greenfield → zero regression risk) OR the **forecast module** (`src/forecast/`, ~5.6k LOC,
most isolated). Measure dev experience, safety (no manual refcount/ptr bugs), perf vs C++.
**Verification gate (this gate decides Rust yes/no):**
- [ ] Pilot module passes the SAME golden/structural tests as its C++ equivalent (or, for greenfield
      DDMRP, its own hand-computed oracle).
- [ ] Measured comparison recorded: LOC, perf (solve time/mem), and a written safety/maintainability
      assessment vs the C++ baseline.
- [ ] **Decision documented**: proceed to wider Rust migration, or stop at the pilot — justified by the
      measurements above, not preference. (A "stop" outcome is a success — it's an answered question.)

**Delivered (first pilot):** Started small + decoupled — ported the JSON number-conversion kernel
(`src/utils/json.cpp` getLong/getInt/getUnsignedLong, the inverted-bound bug site) to a PyO3 extension
`rust/frepple-num/`. Parity = a Rust-vs-C++ diff against a verbatim reference
(`tools/rust-pilot/cxx_reference.cpp`, `test/rust_parity/`, 24/24); evidence + go/no-go in
`tools/modernization/rust-pilot.md`; CI in `.github/workflows/rust-pilot.yml` (cargo test + maturin +
parity, no engine build). All three E4 gates active. **Decision: conditional GO** for targeted Rust on
isolated numeric leaf modules, **NO-GO** for a wholesale engine rewrite. Intentionally CI-only —
shipping the wheel into the engine image is a "go"-only fast-follow.

**Slice 2 (delivered):** ported a real forecasting method — `MovingAverage::generateForecast` +
`smapeWeight` (`src/forecast/timeseries.cpp:294-384`, the `weight[]` OOB site) to `rust/frepple-forecast/`,
parity-diffed 10/10 against a verbatim C++ reference (incl. >MAXBUCKETS series) within 1e-9. Finding:
LOC is comparable (not smaller) for tight numeric code — the win is compile-enforced safety + the PyO3
linkage, not line count. Next slices: SingleExponential / DoubleExponential / Seasonal / Croston.
