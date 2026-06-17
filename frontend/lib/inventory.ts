// Inventory/Buffer screen config (Phase 3). Read-only GridPivot over
// /api/output/inventory/ (buffer.OverviewReport), rendered by the generic
// <PivotScreen>. The report exposes 40+ measures; we show a core subset (the
// full set ships in the response envelope for a later column picker).
import type { PivotScreenConfig } from "@/components/PivotScreen";
import type { PivotSeries } from "./pivot";

// Buffer series label: "item @ location" (+ batch when present).
function inventoryTitle(s: PivotSeries): string {
  const f = s.fields;
  const base = [f.item, f.location].filter(Boolean).join(" @ ");
  return f.batch ? `${base} / ${f.batch}` : base || s.key;
}

export const INVENTORY: PivotScreenConfig = {
  endpoint: "/api/output/inventory/",
  keyField: "buffer",
  eyebrow: "Supply",
  title: "Inventory",
  subtitle:
    "On-hand, safety stock and material flow per buffer across time buckets, from the latest plan.",
  emptyText: "No inventory buffers.",
  shown: [
    { measure: "startoh", label: "Start OH" },
    { measure: "safetystock", label: "Safety stock" },
    { measure: "consumed", label: "Consumed" },
    { measure: "produced", label: "Produced" },
    { measure: "endoh", label: "End OH" },
  ],
  titleOf: inventoryTitle,
};
