// Config + write helpers for the Orders screen (Phase 3 — MO / PO / DO summaries,
// now inline-editable). Each order type is a DRF input list; they share a core
// (reference / item / status / dates / quantity) plus one type-specific column.

import { authedFetch } from "./api";
import { HttpError } from "./errors";
import { fmtDate, fmtNum, type Column, type RecordRow } from "./records";

// Statuses an order can move through; executed ones are locked from editing.
export const ORDER_STATUSES = [
  "proposed",
  "approved",
  "confirmed",
  "completed",
  "closed",
];
const LOCKED = new Set(["completed", "closed"]);

// The editable core columns: status (pill + select), the two dates, the quantity.
const CORE_TAIL: Column[] = [
  { key: "status", label: "Status", pill: true, edit: "select", options: ORDER_STATUSES },
  { key: "startdate", label: "Start", format: fmtDate, edit: "date" },
  { key: "enddate", label: "End", format: fmtDate, edit: "date" },
  { key: "quantity", label: "Qty", align: "right", format: fmtNum, edit: "number" },
];

export type OrderTab = {
  key: string;
  label: string;
  endpoint: string;
  columns: Column[];
};

export const ORDER_TABS: OrderTab[] = [
  {
    key: "MO",
    label: "Manufacturing",
    endpoint: "/api/input/manufacturingorder/",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "item", label: "Item" },
      { key: "operation", label: "Operation" },
      ...CORE_TAIL,
    ],
  },
  {
    key: "PO",
    label: "Purchase",
    endpoint: "/api/input/purchaseorder/",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "item", label: "Item" },
      { key: "supplier", label: "Supplier" },
      { key: "location", label: "Location" },
      ...CORE_TAIL,
    ],
  },
  {
    key: "DO",
    label: "Distribution",
    endpoint: "/api/input/distributionorder/",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "item", label: "Item" },
      { key: "origin", label: "Origin" },
      { key: "destination", label: "Destination" },
      ...CORE_TAIL,
    ],
  },
];

// Executed orders (completed/closed) are read-only — the engine won't move them.
export function canEditOrder(row: RecordRow): boolean {
  return !LOCKED.has(String(row.status ?? "").toLowerCase());
}

// A date edit comes from a <input type=date> as "YYYY-MM-DD"; the API wants a
// naive ISO timestamp. Normalise date-only edits to midnight; pass others through.
export function normalizeChange(key: string, value: unknown): unknown {
  if ((key === "startdate" || key === "enddate") && typeof value === "string") {
    return value.length === 10 ? `${value}T00:00:00` : value;
  }
  return value;
}

// PATCH the changed fields of one order. `listEndpoint` is the tab's list URL;
// the detail resource is `<list>/<reference>/`. Throws AuthError/HttpError.
export async function patchOrder(
  listEndpoint: string,
  reference: string,
  changes: Record<string, unknown>,
  scenario = "",
): Promise<void> {
  const prefix = scenario ? `/${scenario}` : "";
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) body[k] = normalizeChange(k, v);
  const res = await authedFetch(
    `${prefix}${listEndpoint}${encodeURIComponent(reference)}/`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new HttpError(res.status, `save failed: ${res.status}`);
}

// DELETE one order. Throws AuthError/HttpError on failure.
export async function deleteOrder(
  listEndpoint: string,
  reference: string,
  scenario = "",
): Promise<void> {
  const prefix = scenario ? `/${scenario}` : "";
  const res = await authedFetch(
    `${prefix}${listEndpoint}${encodeURIComponent(reference)}/`,
    { method: "DELETE" },
  );
  // DRF returns 204 No Content on a successful delete.
  if (!res.ok && res.status !== 204)
    throw new HttpError(res.status, `delete failed: ${res.status}`);
}
