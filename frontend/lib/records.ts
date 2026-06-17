// Generic flat-record list layer (Phase 3 problem/constraint + order screens).
// Unlike the pivot screens (time-bucketed), these are plain record tables. The
// JSON arrives either as a GridReport stream (`{rows:[...]}`) or a bare DRF array
// (`[...]`); parseRecords normalises both to a row list.

export type RecordRow = Record<string, unknown>;

// A displayed column. `format` maps the raw cell to text; `align` defaults left.
export type Column = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: (value: unknown, row: RecordRow) => string;
};

type RawList = RecordRow[] | { rows?: RecordRow[]; data?: { rows?: RecordRow[] } };

// Normalise a DRF array, a GridReport `{rows}` stream, or an enriched
// `{data:{rows}}` body to a flat row list. Tolerant of null/garbage (-> []).
export function parseRecords(json: RawList | null | undefined): RecordRow[] {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.rows)) return json.rows;
  if (json && json.data && Array.isArray(json.data.rows)) return json.data.rows;
  return [];
}

// Render a cell to a string via the column's formatter, with sane defaults for
// null/dates/numbers so a screen needn't format every field.
export function cellText(col: Column, row: RecordRow): string {
  const v = row[col.key];
  if (col.format) return col.format(v, row);
  if (v == null) return "—";
  return String(v);
}

// Common formatter: an ISO/naive datetime -> "YYYY-MM-DD HH:MM" (or "—").
export function fmtDate(v: unknown): string {
  if (!v) return "—";
  const s = String(v).replace("T", " ");
  return s.length >= 16 ? s.slice(0, 16) : s;
}

// Common formatter: a numeric-ish value -> trimmed number (drops "50.0000000").
export function fmtNum(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? String(n) : String(v);
}
