// Resource screen config (Phase 3). Read-only GridPivot over
// /api/output/resource/ (resource.OverviewReport), rendered by the generic
// <PivotScreen>. Utilization-pivot view; the timeline Gantt is a later increment.
import type { PivotScreenConfig } from "@/components/PivotScreen";
import type { PivotSeries } from "./pivot";

function resourceTitle(s: PivotSeries): string {
  return String(s.fields.resource ?? s.key);
}

export const RESOURCE: PivotScreenConfig = {
  endpoint: "/api/output/resource/",
  keyField: "resource",
  eyebrow: "Capacity",
  title: "Resource",
  subtitle:
    "Available capacity, load and utilization per resource across time buckets.",
  emptyText: "No resources.",
  shown: [
    { measure: "available", label: "Available" },
    { measure: "load", label: "Load" },
    { measure: "utilization", label: "Utilization %" },
    { measure: "load_confirmed", label: "Load (confirmed)" },
  ],
  titleOf: resourceTitle,
};
