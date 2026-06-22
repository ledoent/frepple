"use client";

import PivotScreen from "@/components/PivotScreen";
import { RESOURCE } from "@/lib/resource";

// Phase 3 — Resource report. Read-only pivot of resources x time buckets
// (/api/output/resource/, enriched PivotJSONStreamView).
export default function ResourcePage() {
  return <PivotScreen {...RESOURCE} />;
}
