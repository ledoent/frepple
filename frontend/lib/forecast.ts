// Forecast data layer (Phase 1B). Typed wrapper over the generic GridPivot
// parser in ./pivot — the forecast OUTPUT report is a GridPivot, so the actual
// pivot logic (scalars->fields, arrays->per-bucket measure cells) lives there and
// is shared with the other pivot screens (inventory, …).
import {
  pivotRows,
  bucketOrder,
  type PivotRowResponse,
  type BucketMeta,
} from "./pivot";

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

export type ForecastPivotResponse = PivotRowResponse;

export type ForecastCell = Partial<Record<Measure, number | null>>;

export type ForecastSeries = {
  key: string; // first row-field value (the series identity)
  fields: Record<string, string | number | null>; // item/location/customer/...
  buckets: Record<string, ForecastCell>; // bucketName -> measures
};

const DEFAULT_ROW_FIELDS = ["item", "location", "customer"];

// Typed wrapper over the generic pivotRows (./pivot): the forecast key is the
// first row-field (item). NO top-300 truncation (fc-no-truncation).
export function pivotForecast(
  resp: ForecastPivotResponse,
  measures: readonly Measure[] = MEASURES,
  rowFields: string[] = DEFAULT_ROW_FIELDS,
): ForecastSeries[] {
  return pivotRows(resp, measures, rowFields[0]) as ForecastSeries[];
}

// The ordered bucket names across all series (union, preserving first-seen order).
export function bucketNames(series: ForecastSeries[]): string[] {
  return bucketOrder(series);
}

// Flatten one series into chart rows (one point per bucket) for plotting
// orders / baseline / net over time. Pure, unit-tested.
export type ForecastChartRow = {
  bucket: string;
  orders: number | null;
  baseline: number | null;
  net: number | null;
};

export function toChartRows(
  series: ForecastSeries,
  buckets: { name: string }[],
): ForecastChartRow[] {
  return buckets.map((b) => {
    const cell = series.buckets[b.name] ?? {};
    return {
      bucket: b.name,
      orders: cell.orderstotal ?? null,
      baseline: cell.forecastbaseline ?? null,
      net: cell.forecastnet ?? null,
    };
  });
}

// The enriched forecast response (Phase 1B): the report's pivot object under
// `data`, plus the measure order and bucket dates the editor needs.
export type ForecastBucketMeta = BucketMeta;

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

// Build the ForecastService (/forecast/detail/) message for a set of edits:
// {item, location, customer, buckets:[{startdate, enddate, bucket, forecastoverride}]}.
export function buildBulkOverrideMessage(
  series: ForecastSeries,
  edits: { bucket: ForecastBucketMeta; value: number | null }[],
): OverrideMessage {
  const f = series.fields;
  return {
    item: (f.item as string) ?? null,
    location: (f.location as string) ?? null,
    customer: (f.customer as string) ?? null,
    buckets: edits.map((e) => ({
      bucket: e.bucket.name,
      startdate: e.bucket.startdate,
      enddate: e.bucket.enddate,
      forecastoverride: e.value,
    })),
  };
}

// One-cell convenience wrapper.
export function buildOverrideMessage(
  series: ForecastSeries,
  bucket: ForecastBucketMeta,
  value: number | null,
): OverrideMessage {
  return buildBulkOverrideMessage(series, [{ bucket, value }]);
}
