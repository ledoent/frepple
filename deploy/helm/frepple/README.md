# frePPLe staging Helm chart

A clickable review env for the modernized Execute + Forecast screens on the real
C++ engine. Single same-origin ingress (SPA + REST + websockets), TLS via
cert-manager. See `MODERNIZATION_PLAN.md` § Phase 3.5.

## Topology
- **app** Deployment (engine image, `replicas: 1`, `Recreate`): two containers —
  `web` (`entrypoint.sh wsgi`: DB init + `runserver --insecure` :8000, spawns the
  worker on task launch) and `asgi` (`entrypoint.sh asgi`: daphne :8001) — sharing
  an `emptyDir` log dir at `/app/logs` (the worker writes task logs, asgi tails
  them). Co-located + single-replica because the cluster has only RWO storage.
- **frontend** Deployment (Next.js SPA :3000).
- **redis** Deployment (channels fan-out).
- **Ingress** (nginx, TLS): `/ws`,`/forecast/detail`,`/flush` → asgi;
  `/api`,`/data`,`/static`,`/execute/launch` → web; `/` → SPA.
- **Postgres**: external by default (`shared-db-rw.cnpg.svc`); `postgres.mode:
  builtin` deploys an in-release `postgres:16` + RWO PVC instead.

## Build images (ledoent ARC → GHCR)
`.github/workflows/deploy-staging.yml` (trigger: push to `modernization` touching
the image sources, or `workflow_dispatch`) builds and pushes
`ghcr.io/ledoent/frepple-app:<sha>` and `…/frepple-frontend:<sha>`.

## First deploy
```sh
kubectl create ns frepple-staging
# pull secret + DB creds (CNPG superuser):
kubectl -n bimble-staging get secret ghcr-pull -o yaml | \
  sed 's/namespace: bimble-staging//' | kubectl -n frepple-staging apply -f -
kubectl -n frepple-staging create secret generic frepple-db \
  --from-literal=POSTGRES_USER="$(kubectl -n cnpg get secret shared-db-superuser -o jsonpath='{.data.username}' | base64 -d)" \
  --from-literal=POSTGRES_PASSWORD="$(kubectl -n cnpg get secret shared-db-superuser -o jsonpath='{.data.password}' | base64 -d)"

helm upgrade --install frepple deploy/helm/frepple -n frepple-staging \
  --set image.tag=<sha>
```

## Test a new image
```sh
git push ledoent modernization          # triggers the build workflow
helm upgrade --install frepple deploy/helm/frepple -n frepple-staging \
  --set image.tag=<new-sha>
kubectl -n frepple-staging rollout status deploy/frepple-app deploy/frepple-frontend
```

## Verify
```sh
E2E_BASE_URL=https://frepple-staging.hz.ledoweb.com E2E_ENGINE=1 \
  npx playwright test --config e2e/playwright/playwright.config.ts
```
Browse https://frepple-staging.hz.ledoweb.com (login `admin`/`admin`): **/execute**
(Run plan → live progress) and **/forecast** (grid, chart, bulk edit).
