// Demand screen config (Phase 3). Read-only GridPivot over /api/output/demand/
// (demand.OverviewReport), rendered by the generic <PivotScreen>.
import type { PivotScreenConfig } from "@/components/PivotScreen";
import type { PivotSeries } from "./pivot";

function demandTitle(s: PivotSeries): string {
  return String(s.fields.item ?? s.key);
}

export const DEMAND: PivotScreenConfig = {
  endpoint: "/api/output/demand/",
  keyField: "item",
  eyebrow: "Demand planning",
  title: "Demand",
  subtitle:
    "Sales orders, the supply that covers them and the remaining backlog per item across time buckets.",
  emptyText: "No demand series.",
  shown: [
    { measure: "demand", label: "Orders" },
    { measure: "supply", label: "Supply" },
    { measure: "backlog", label: "Backlog" },
  ],
  titleOf: demandTitle,
};
