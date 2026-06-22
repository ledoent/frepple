#!/usr/bin/env bash
#
# Regenerate the typed TypeScript client from the frePPLe OpenAPI schema (Phase 0).
#
# Two committed artifacts are the source of truth (so the SPA builds/typechecks
# without a Django runtime), and CI runs this script + `git diff --exit-code` to
# guarantee they never drift from the live API:
#
#   generated/openapi.yaml        - the OpenAPI 3 schema (drf-spectacular)
#   frontend/lib/api-types.ts     - the typed client (openapi-typescript)
#
# Run where a frePPLe Django runtime + Node.js are available (a dev box or CI).
# Usage: tools/modernization/gen_api_client.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SCHEMA="generated/openapi.yaml"
mkdir -p generated

# 1. Emit the OpenAPI 3 schema from the Django app. --validate fails on an
#    invalid schema (operationId collisions are warnings, auto-resolved).
echo ">> generating OpenAPI schema -> ${SCHEMA}"
./frepplectl.py spectacular --validate --file "${SCHEMA}"

# 2. Generate the typed client into the SPA (openapi-typescript). npx auto-fetches
#    it, so CI needn't `pnpm install` the frontend. Same output path as the
#    frontend's own `gen:api` script (lib/api-types.ts).
CLIENT="frontend/lib/api-types.ts"
# Pin to the frontend's openapi-typescript version so CI regeneration is
# byte-identical to a local `pnpm gen:api` (the drift gate compares them).
OAT_VERSION="$(node -p "const p=require('./frontend/package.json'); (p.devDependencies||{})['openapi-typescript'] || (p.dependencies||{})['openapi-typescript'] || '7.0.0'" 2>/dev/null || echo 7.0.0)"
echo ">> generating typed client -> ${CLIENT} (openapi-typescript@${OAT_VERSION})"
npx --yes "openapi-typescript@${OAT_VERSION}" "${SCHEMA}" -o "${CLIENT}"

# 3. Type-check the generated client (strict) so a bad schema fails the build.
echo ">> type-checking the generated client"
npx --yes -p typescript tsc --noEmit --strict --skipLibCheck "${CLIENT}"

echo ">> done: ${SCHEMA}, frontend/lib/api-types.ts"
