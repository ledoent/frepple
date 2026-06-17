# E2E harness

End-to-end verification of the modernized screens (Phase 1A Execute, Phase 1B
Forecast) against a real running stack.

## What it runs

A `docker compose` stack with **no C++ engine build** — Django and daphne run
engine-free (the ASGI loader tolerates a missing `frepple` module), so the stack
comes up in minutes:

| service   | role |
|-----------|------|
| `db`      | postgres 16 |
| `redis`   | channels layer (live task progress) |
| `web-wsgi`| Django dev server — REST API, `/api/token/`, output endpoints. Also does one-time DB init (createdatabase + migrate + demo data). |
| `web-asgi`| daphne — websockets (`ws/tasks/`, log tail) + engine HTTP services |
| `frontend`| production Next.js build (`/frontend`) |
| `nginx`   | single same-origin proxy: `/ws`+`/forecast`+`/flush`→asgi, `/api`+`/data`→wsgi, `/`→spa |

The origin is `http://127.0.0.1:18080`.

## Run

```sh
# from the repo root
docker compose -f e2e/docker-compose.yml up --build -d
# wait for web-wsgi to finish migrate + demo load (watch its logs)

cd e2e/playwright
npm ci
npx playwright install --with-deps chromium
npm test

# teardown
docker compose -f e2e/docker-compose.yml down -v
```

## Scope

Covered: auth (`/api/token/`), the Execute websocket (token → subprotocol JWT →
`ws/tasks/` consumer), the enriched forecast read + pivot grid.

Out of scope (needs the compiled engine): launching a real plan and the override
re-net. Add an engine-backed service later to extend `fc-edit-parity` /
live-progress coverage.

## Engine overlay (live planning)

The lean stack omits the C++ engine. To verify real planning flows (runplan ->
live task progress), add the engine overlay and run with E2E_ENGINE=1:

```sh
docker compose -f e2e/docker-compose.yml -f e2e/docker-compose.engine.yml up --build -d
cd e2e/playwright && E2E_ENGINE=1 npx playwright test
```

Note: forecast override re-net (ForecastService) needs the asgi to run inside the
frepple interpreter (frepplectl runwebservice); not yet wired here.

The engine overlay sets `FREPPLE_INIT_RUNPLAN`, so `web-wsgi` computes one plan on
startup. That warms the engine (CPython + demo dataset) and fires the
Redis->websocket path once, so the live-progress test's own launch reaches a
terminal state in seconds instead of racing a cold engine.

## CI

`.github/workflows/frontend-e2e.yml` (`Frontend E2E (compose)`) runs this harness
**with the engine overlay** on pushes to `modernization` and on PRs into
`master`/`modernization` (path-filtered to `frontend/`, `e2e/`, `freppledb/`). The
compiled C++ engine is **restored from the deploy-staging buildx registry cache**
(`ghcr.io/ledoent/frepple-app:buildcache`) rather than recompiled, so the job is
~5 min. It waits for the startup warmup plan to reach `Done` before running the
full Playwright suite (smoke + a11y across all five screens + engine-backed
live-progress), making it the backward-compat guardrail for the SPA.
