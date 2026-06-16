// Forecast data layer (Phase 1B). The forecast OUTPUT report is a GridPivot:
// /api/v1/output/forecast/ streams {total,page,records,rows:[...]} where each row
// is one series (item/location/customer + other row-fields) plus one key per time
// bucket whose value is an ARRAY of measure values in the report's "crosses"
// order. The arrays are not self-describing, so the measure order is supplied
// explicitly (from the report metadata) to map array slots -> named measures.

export const MEASURES = [
  "orderstotal",
  "ordersopen",
  "ordersadjustment",
  "forecastbaseline",
  "forecastoverride",
  "forecasttotal",
  "forecastnet",
  "forecastconsumed",
] as const;

export type Measure = (typeof MEASURES)[number];

// Measures a user can edit in the grid; everything else is computed/read-only.
export const EDITABLE_MEASURES: ReadonlySet<Measure> = new Set<Measure>([
  "forecastoverride",
]);

export type ForecastPivotResponse = {
  total: number;
  page: number;
  records: number;
  rows: Array<Record<string, unknown>>;
};

export type ForecastCell = Partial<Record<Measure, number | null>>;

export type ForecastSeries = {
  key: string; // first row-field value (the series identity)
  fields: Record<string, string | number | null>; // item/location/customer/...
  buckets: Record<string, ForecastCell>; // bucketName -> measures
};

const DEFAULT_ROW_FIELDS = ["item", "location", "customer"];

// Turn the pivot response into series with named per-bucket measure cells.
// Scalar row values are series fields; array row values are time buckets.
export function pivotForecast(
  resp: ForecastPivotResponse,
  measures: readonly Measure[] = MEASURES,
  rowFields: string[] = DEFAULT_ROW_FIELDS,
): ForecastSeries[] {
  const out: ForecastSeries[] = [];
  for (const row of resp.rows ?? []) {
    const fields: Record<string, string | number | null> = {};
    const buckets: Record<string, ForecastCell> = {};
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v)) {
        const cell: ForecastCell = {};
        measures.forEach((m, idx) => {
          const val = v[idx];
          cell[m] = val == null ? null : Number(val);
        });
        buckets[k] = cell;
      } else {
        fields[k] = v as string | number | null;
      }
    }
    out.push({ key: String(fields[rowFields[0]] ?? ""), fields, buckets });
  }
  return out; // NO top-300 truncation - every series is returned (fc-no-truncation)
}

// The ordered bucket names across all series (union, preserving first-seen order).
export function bucketNames(series: ForecastSeries[]): string[] {
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

// The enriched forecast response (Phase 1B): the report's pivot object under
// `data`, plus the measure order and bucket dates the editor needs.
export type ForecastBucketMeta = {
  name: string;
  startdate: string | null;
  enddate: string | null;
};

export type ForecastResponse = {
  measures?: Measure[];
  buckets?: ForecastBucketMeta[];
  data: ForecastPivotResponse;
};

export function parseForecast(resp: ForecastResponse): {
  measures: readonly Measure[];
  buckets: ForecastBucketMeta[];
  series: ForecastSeries[];
} {
  const measures = resp.measures?.length ? resp.measures : MEASURES;
  const series = pivotForecast(resp.data, measures);
  const buckets =
    resp.buckets && resp.buckets.length
      ? resp.buckets
      : bucketNames(series).map((name) => ({
          name,
          startdate: null,
          enddate: null,
        }));
  return { measures, buckets, series };
}

export type OverrideMessage = {
  item: string | null;
  location: string | null;
  customer: string | null;
  buckets: {
    bucket: string;
    startdate: string | null;
    enddate: string | null;
    forecastoverride: number | null;
  }[];
};

// Build the ForecastService (/forecast/detail/) message for one cell edit:
// {item, location, customer, buckets:[{startdate, enddate, bucket, forecastoverride}]}.
export function buildOverrideMessage(
  series: ForecastSeries,
  bucket: ForecastBucketMeta,
  value: number | null,
): OverrideMessage {
  const f = series.fields;
  return {
    item: (f.item as string) ?? null,
    location: (f.location as string) ?? null,
    customer: (f.customer as string) ?? null,
    buckets: [
      {
        bucket: bucket.name,
        startdate: bucket.startdate,
        enddate: bucket.enddate,
        forecastoverride: value,
      },
    ],
  };
}
