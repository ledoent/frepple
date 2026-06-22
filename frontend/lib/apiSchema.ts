// Typed API surface for the SPA (Phase 0 — typed client).
//
// Re-exports types generated from the live OpenAPI schema: `api-types.ts` is
// produced by `pnpm gen:api` (openapi-typescript) from `generated/openapi.yaml`,
// which `frepplectl.py spectacular` emits from the Django app. Importing these
// type-couples the frontend to the API contract — a field/enum rename in Django
// surfaces here as a TypeScript error (CI regenerates + diff-checks the client).
//
// Scope note: the streaming OUTPUT endpoints (pivot reports, pegging) are plain
// Django views with no DRF serializer, so they're absent from the schema and keep
// their hand-written shapes (their columns are dynamic time-buckets anyway). The
// typed surface here is the DRF input/master-data CRUD the SPA mutates.

import type { components } from "./api-types";

export type Schemas = components["schemas"];

/** The three operationplan order types exposed as DRF input lists. */
export type ManufacturingOrder = Schemas["ManufacturingOrder"];
export type PurchaseOrder = Schemas["PurchaseOrder"];
export type DistributionOrder = Schemas["DistributionOrder"];

/** Order lifecycle status, straight from the API enum (StatusCa7Enum). */
export type OrderStatus = Schemas["StatusCa7Enum"];
