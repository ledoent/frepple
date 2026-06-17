"use client";

import TabListScreen from "@/components/TabListScreen";
import { ORDER_TABS, canEditOrder, deleteOrder, patchOrder } from "@/lib/orders";
import type { RecordRow } from "@/lib/records";

// Orders screen (Phase 3): manufacturing / purchase / distribution order summaries
// from the input REST API. One tab per order type, per-type columns, with inline
// edit (quantity / dates / status) + delete; executed orders are locked.
// (Create needs an operation/item picker — a documented follow-on.)
export default function OrdersPage() {
  return (
    <TabListScreen
      eyebrow="Supply"
      title="Orders"
      subtitle="Manufacturing, purchase and distribution orders the plan proposes or confirms — edit dates, quantity or status inline; the engine re-plans the rest."
      path="/orders"
      tabs={ORDER_TABS}
      filterKeys={["reference", "item", "status"]}
      editable={{
        rowKey: "reference",
        canEdit: canEditOrder,
        save: (endpoint, row: RecordRow, changes) =>
          patchOrder(endpoint, String(row.reference), changes),
        remove: (endpoint, row: RecordRow) =>
          deleteOrder(endpoint, String(row.reference)),
      }}
      emptyText="NO ORDERS — NONE PLANNED YET"
    />
  );
}
