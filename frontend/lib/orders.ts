// Config for the Orders screen (Phase 3 — MO / PO / DO summaries). Each order
// type is a DRF input list; they share a core (reference / item / status / dates
// / quantity) plus one type-specific column.

import { fmtDate, fmtNum, type Column } from "./records";

const CORE_TAIL: Column[] = [
  { key: "status", label: "Status" },
  { key: "startdate", label: "Start", format: fmtDate },
  { key: "enddate", label: "End", format: fmtDate },
  { key: "quantity", label: "Qty", align: "right", format: fmtNum },
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
