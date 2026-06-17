"use client";

import TabListScreen from "@/components/TabListScreen";
import { ORDER_TABS } from "@/lib/orders";

// Orders screen (Phase 3): manufacturing / purchase / distribution order summaries
// from the input REST API. One tab per order type, per-type columns. Read-only
// here — inline editing is a follow-on (the pegging Gantt does the date writes).
export default function OrdersPage() {
  return (
    <TabListScreen
      eyebrow="Supply"
      title="Orders"
      subtitle="Manufacturing, purchase and distribution orders the plan proposes or confirms — the supply side of the plan."
      path="/orders"
      tabs={ORDER_TABS}
      filterKeys={["reference", "item", "status"]}
      emptyText="NO ORDERS — NONE PLANNED YET"
    />
  );
}
