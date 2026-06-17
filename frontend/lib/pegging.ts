// Data layer for the Demand Pegging Gantt (Phase 3-D). Parses the enriched
// /api/output/pegging/<demand>/ response into a typed tree of pegging rows +
// timeline bars, and provides the date->fraction geometry the Gantt renders
// with. Pure + framework-free so it unit-tests without React (see pegging.test.ts).

// The absolute horizon + marker dates the server computes (ISO strings). The
// bare report stream drops these hidden columns; PeggingJSONView prepends them.
export type PeggingWindow = {
  start: string | null;
  end: string | null;
  due: string | null; // the demand's due date (the red marker)
  current: string | null; // "now" / last-plan date (the neutral marker)
};

// One scheduled operationplan = one bar on a lane.
export type PeggingBar = {
  reference: string;
  operation: string;
  start: string; // raw "YYYY-MM-DD HH:MM:SS" (engine output, naive)
  end: string;
  quantity: number;
  status: string; // proposed | approved | confirmed | completed | closed
  type: string; // MO | WO | PO | DO | DLVR | STCK
  color: number | null; // criticality/delay color code (0..100)
  criticality: number;
  item: string | null;
  location: string | null;
};

// One node of the demand's supply-chain tree = one Gantt row (lane of bars).
export type PeggingRow = {
  id: string;
  depth: number; // 1 = the demand's delivery; deeper = upstream supply
  operation: string;
  type: string;
  item: string | null;
  quantity: number; // required quantity pegged to the demand
  bars: PeggingBar[];
};

export type Pegging = {
  window: PeggingWindow;
  rows: PeggingRow[];
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

// The enriched endpoint's shape (loose - tolerate missing/streamed-empty bodies).
type RawBar = Record<string, unknown>;
type RawRow = { operationplans?: RawBar[] } & Record<string, unknown>;
type RawPegging = {
  window?: Partial<PeggingWindow>;
  data?: { rows?: RawRow[] };
};

// Parse the /api/output/pegging/<demand>/ JSON into the typed tree. Tolerant of
// an empty/legacy (unwrapped) body so the screen degrades to "no plan" instead
// of throwing.
export function parsePegging(json: RawPegging | null | undefined): Pegging {
  const window: PeggingWindow = {
    start: json?.window?.start ?? null,
    end: json?.window?.end ?? null,
    due: json?.window?.due ?? null,
    current: json?.window?.current ?? null,
  };
  const rawRows = json?.data?.rows ?? [];
  const rows: PeggingRow[] = rawRows.map((r) => ({
    id: String(r.id ?? ""),
    depth: num(r.depth),
    operation: String(r.operation ?? ""),
    type: String(r.type ?? ""),
    item: (r.item as string) ?? null,
    quantity: num(r.quantity),
    bars: (r.operationplans ?? []).map((b) => ({
      reference: String(b.reference ?? ""),
      operation: String(b.operation ?? ""),
      start: String(b.startdate ?? ""),
      end: String(b.enddate ?? ""),
      quantity: num(b.quantity),
      status: String(b.status ?? ""),
      type: String(b.type ?? ""),
      color: b.color == null ? null : num(b.color),
      criticality: num(b.criticality),
      item: (b.item as string) ?? null,
      location: (b.location as string) ?? null,
    })),
  }));
  return { window, rows };
}

// Engine timestamps come as "YYYY-MM-DD HH:MM:SS" (naive); the window comes as
// ISO. Normalize both to epoch ms so positions are consistent. Returns NaN for
// blanks so callers can skip un-dated bars.
export function parseEngineDate(s: string | null | undefined): number {
  if (!s) return NaN;
  return new Date(s.includes("T") ? s : s.replace(" ", "T")).getTime();
}

// Position of a date within [start,end] as a 0..1 fraction, clamped. Returns
// null when the window is degenerate/unparseable (caller hides the timeline).
export function fractionOf(
  date: string | null | undefined,
  startMs: number,
  endMs: number,
): number | null {
  const span = endMs - startMs;
  if (!Number.isFinite(span) || span <= 0) return null;
  const t = parseEngineDate(date ?? "");
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.min(1, (t - startMs) / span));
}

// Build ~`count` evenly spaced axis ticks across the window, snapped to day
// boundaries, as {fraction, label} for the Gantt header.
export function axisTicks(
  window: PeggingWindow,
  count = 6,
): { fraction: number; label: string }[] {
  const startMs = parseEngineDate(window.start);
  const endMs = parseEngineDate(window.end);
  const span = endMs - startMs;
  if (!Number.isFinite(span) || span <= 0) return [];
  const day = 86_400_000;
  const rawStep = span / count;
  const step = Math.max(day, Math.round(rawStep / day) * day); // whole days
  const ticks: { fraction: number; label: string }[] = [];
  for (let t = startMs; t <= endMs + 1; t += step) {
    ticks.push({
      fraction: Math.max(0, Math.min(1, (t - startMs) / span)),
      label: new Date(t).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    });
  }
  return ticks;
}
