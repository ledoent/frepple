// Generic GridPivot data layer, shared by the SPA's pivot screens (forecast,
// inventory, …). The enriched output endpoint (PivotJSONStreamView) returns
//   { measures: string[], buckets: BucketMeta[], data: { rows: [...] } }
// where each row is one series: scalar values are dimension fields and array
// values are time buckets holding the measure values in `measures` order. The
// arrays are not self-describing, so the measure order comes from the envelope.

export type BucketMeta = {
  name: string;
  startdate: string | null;
  enddate: string | null;
};

export type PivotRowResponse = {
  total?: number;
  page?: number;
  records?: number;
  rows?: Array<Record<string, unknown>>;
};

export type PivotResponse = {
  measures?: string[];
  buckets?: BucketMeta[];
  data: PivotRowResponse;
};

// One series: dimension fields + per-bucket { measure -> value } cells.
export type PivotCell = Record<string, number | null>;
export type PivotSeries = {
  key: string; // the chosen key-field value (the series identity)
  fields: Record<string, string | number | null>;
  buckets: Record<string, PivotCell>;
};

// Turn the pivot row list into series with named per-bucket measure cells.
// Scalar row values are series fields; array row values are time buckets.
export function pivotRows(
  resp: PivotRowResponse,
  measures: readonly string[],
  keyField: string,
): PivotSeries[] {
  const out: PivotSeries[] = [];
  for (const row of resp.rows ?? []) {
    const fields: Record<string, string | number | null> = {};
    const buckets: Record<string, PivotCell> = {};
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v)) {
        const cell: PivotCell = {};
        measures.forEach((m, idx) => {
          const val = v[idx];
          cell[m] = val == null ? null : Number(val);
        });
        buckets[k] = cell;
      } else {
        fields[k] = v as string | number | null;
      }
    }
    out.push({ key: String(fields[keyField] ?? ""), fields, buckets });
  }
  return out; // NO truncation - every series is returned
}

// The ordered bucket names across all series (union, preserving first-seen order).
export function bucketOrder(series: PivotSeries[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const s of series) {
    for (const b of Object.keys(s.buckets)) {
      if (!seen.has(b)) {
        seen.add(b);
        order.push(b);
      }
    }
  }
  return order;
}

// Parse a full enriched envelope into { measures, buckets, series }. When the
// envelope omits measures/buckets (older/bare endpoint) the caller's fallback
// measure order is used and bucket dates are left null.
export function parsePivot(
  resp: PivotResponse,
  opts: { keyField: string; fallbackMeasures?: readonly string[] },
): { measures: string[]; buckets: BucketMeta[]; series: PivotSeries[] } {
  const measures = (
    resp.measures?.length ? resp.measures : (opts.fallbackMeasures ?? [])
  ) as string[];
  const series = pivotRows(resp.data, measures, opts.keyField);
  const buckets =
    resp.buckets && resp.buckets.length
      ? resp.buckets
      : bucketOrder(series).map((name) => ({
          name,
          startdate: null,
          enddate: null,
        }));
  return { measures, buckets, series };
}
