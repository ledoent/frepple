"use client";

import PivotScreen from "@/components/PivotScreen";
import { INVENTORY } from "@/lib/inventory";

// Phase 3 — Inventory/Buffer report. Read-only pivot of buffers x time buckets
// from the real plan (/api/output/inventory/, enriched PivotJSONStreamView).
export default function InventoryPage() {
  return <PivotScreen {...INVENTORY} />;
}
