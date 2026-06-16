// Inventory/Buffer data layer (Phase 3). Read-only GridPivot over
// /api/output/inventory/ (buffer.OverviewReport), parsed with the generic
// ./pivot helpers. The report exposes 40+ measures; the screen shows a core
// subset by default (the full set ships in the response envelope for a later
// column picker).
import type { PivotSeries } from "./pivot";

// Row identity for a buffer row: the report's `buffer` field is unique.
export const INVENTORY_KEY_FIELD = "buffer";

// Measures shown by default, with display labels, in render order.
export const INVENTORY_SHOWN: { measure: string; label: string }[] = [
  { measure: "startoh", label: "Start OH" },
  { measure: "safetystock", label: "Safety stock" },
  { measure: "consumed", label: "Consumed" },
  { measure: "produced", label: "Produced" },
  { measure: "endoh", label: "End OH" },
];

// Human label for a buffer series: "item @ location" (+ batch when present),
// falling back to the row key.
export function inventoryTitle(s: PivotSeries): string {
  const f = s.fields;
  const base = [f.item, f.location].filter(Boolean).join(" @ ");
  return f.batch ? `${base} / ${f.batch}` : base || s.key;
}

export type InventorySeries = PivotSeries;
