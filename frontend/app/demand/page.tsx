"use client";

import PivotScreen from "@/components/PivotScreen";
import { DEMAND } from "@/lib/demand";

// Phase 3 — Demand report. Read-only pivot of items x time buckets
// (/api/output/demand/, enriched PivotJSONStreamView).
export default function DemandPage() {
  return <PivotScreen {...DEMAND} />;
}
