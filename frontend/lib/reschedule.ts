// Reschedule write-path for the pegging Gantt (Phase 3-D2). Drag a bar → shift
// its start/end by the dragged time delta → PATCH the operationplan's dates.
// Pure helpers here (endpoint map, editability, date math) so they unit-test
// without React or the network; the PATCH itself is one small authedFetch.

import { authedFetch } from "./api";
import { HttpError } from "./errors";
import { parseEngineDate } from "./pegging";

// frePPLe splits operationplans into per-type DRF detail endpoints. The bar's
// `type` selects which one to PATCH. STCK (inventory) has no reschedule endpoint.
const TYPE_ENDPOINT: Record<string, string> = {
  MO: "manufacturingorder",
  WO: "workorder",
  PO: "purchaseorder",
  DO: "distributionorder",
  DLVR: "deliveryorder",
};

// Statuses we won't let the user drag — the operationplan is already executed,
// so moving its dates is meaningless (and the engine forbids it).
const LOCKED_STATUSES = new Set(["completed", "closed"]);

export function rescheduleEndpoint(type: string): string | null {
  return TYPE_ENDPOINT[type] ?? null;
}

export function isReschedulable(type: string, status: string): boolean {
  return (
    rescheduleEndpoint(type) != null &&
    !LOCKED_STATUSES.has((status || "").toLowerCase())
  );
}

// Pad a number to 2 digits for the naive ISO formatter.
function p2(n: number): string {
  return String(n).padStart(2, "0");
}

// Shift a naive engine timestamp ("YYYY-MM-DD HH:MM:SS") by `deltaMs` and return
// a naive ISO string ("YYYY-MM-DDTHH:MM:SS") — no timezone suffix, matching the
// engine's tz-naive convention so a round-trip doesn't drift by the UTC offset.
// Returns null when the input can't be parsed (caller skips the PATCH).
export function shiftEngineDate(engineDate: string, deltaMs: number): string | null {
  const t = parseEngineDate(engineDate);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + deltaMs);
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
    `T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  );
}

// PATCH an operationplan's start/end dates. `reference` is the DRF lookup. The
// scenario prefix routes to the right database (same convention as the reads).
// Throws AuthError (via authedFetch) on 401/403, HttpError on any other non-2xx.
export async function patchReschedule(opts: {
  type: string;
  reference: string;
  startdate: string; // naive ISO
  enddate: string; // naive ISO
  scenario?: string;
}): Promise<void> {
  const endpoint = rescheduleEndpoint(opts.type);
  if (!endpoint) throw new Error(`${opts.type} is not reschedulable`);
  const prefix = opts.scenario ? `/${opts.scenario}` : "";
  const path = `${prefix}/api/input/${endpoint}/${encodeURIComponent(opts.reference)}/`;
  const res = await authedFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startdate: opts.startdate, enddate: opts.enddate }),
  });
  if (!res.ok) {
    throw new HttpError(res.status, `reschedule failed: ${res.status}`);
  }
}
