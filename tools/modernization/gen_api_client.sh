#!/usr/bin/env bash
#
# Generate a typed TypeScript client from the frePPLe OpenAPI schema (Phase 0).
#
# Run this where a frePPLe Django runtime is available (a dev box or CI) and
# Node.js is installed. It emits the OpenAPI document and a typed client into
# the target directory (default: ./generated). In Phase 1 this runs as the
# Next.js app's codegen step so the SPA stays type-safe against the API.
#
# Usage:
#   tools/modernization/gen_api_client.sh [OUTDIR]
#
set -euo pipefail

OUTDIR="${1:-generated}"
SCHEMA="${OUTDIR}/openapi.yaml"
CLIENT="${OUTDIR}/api-types.ts"

mkdir -p "${OUTDIR}"

# 1. Emit the OpenAPI 3 schema from the live Django app (drf-spectacular).
#    --validate fails the build on an invalid schema.
echo ">> generating OpenAPI schema -> ${SCHEMA}"
./frepplectl.py spectacular --validate --file "${SCHEMA}"

# 2. Generate TypeScript types from the schema. openapi-typescript emits a
#    single, dependency-free .d.ts-style types file; pair with openapi-fetch
#    in the SPA for a typed client. (Swap for openapi-generator/orval if a
#    full client with hooks is preferred.)
echo ">> generating TypeScript types -> ${CLIENT}"
npx --yes openapi-typescript "${SCHEMA}" -o "${CLIENT}"

# 3. Smoke type-check the generated file.
echo ">> type-checking ${CLIENT}"
npx --yes typescript tsc --noEmit --strict "${CLIENT}"

echo ">> done: ${SCHEMA}, ${CLIENT}"
