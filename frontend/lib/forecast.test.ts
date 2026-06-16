import { describe, it, expect } from "vitest";
import {
  pivotForecast,
  bucketNames,
  parseForecast,
  buildOverrideMessage,
  buildBulkOverrideMessage,
  MEASURES,
} from "./forecast";

const resp = {
  total: 1,
  page: 1,
  records: 2,
  rows: [
    {
      item: "itemA",
      location: "loc1",
      customer: "custX",
      // measure order: orderstotal, ordersopen, ordersadjustment, forecastbaseline,
      //                forecastoverride, forecasttotal, forecastnet, forecastconsumed
      "Jan 26": [10, 5, 0, 8, 2, 8, 10, 0],
      "Feb 26": [12, 6, 1, 9, 0, 9, 9, 3],
    },
    {
      item: "itemB",
      location: "loc1",
      customer: "custY",
      "Jan 26": [0, 0, 0, 4, null, 4, 4, 0],
      "Feb 26": [1, 1, 0, 5, 0, 5, 5, 0],
    },
  ],
};

describe("pivotForecast", () => {
  it("maps per-bucket arrays to named measures", () => {
    const series = pivotForecast(resp);
    expect(series).toHaveLength(2);
    expect(series[0].key).toBe("itemA");
    expect(series[0].fields.location).toBe("loc1");
    expect(series[0].buckets["Jan 26"].forecastnet).toBe(10);
    expect(series[0].buckets["Jan 26"].forecastoverride).toBe(2);
    expect(series[1].buckets["Feb 26"].forecastbaseline).toBe(5);
  });

  it("preserves nulls as null (not 0)", () => {
    const series = pivotForecast(resp);
    expect(series[1].buckets["Jan 26"].forecastoverride).toBeNull();
  });

  it("does not truncate large result sets (fc-no-truncation)", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      item: `item${i}`,
      "Jan 26": [1, 2, 3, 4, 5, 6, 7, 8],
    }));
    const series = pivotForecast({ total: 1, page: 1, records: 500, rows });
    expect(series).toHaveLength(500);
  });

  it("treats scalar fields as identity and arrays as buckets", () => {
    const series = pivotForecast(resp);
    expect(Object.keys(series[0].fields).sort()).toEqual([
      "customer",
      "item",
      "location",
    ]);
    expect(Object.keys(series[0].buckets)).toEqual(["Jan 26", "Feb 26"]);
  });
});

describe("bucketNames", () => {
  it("returns the ordered union of bucket names", () => {
    expect(bucketNames(pivotForecast(resp))).toEqual(["Jan 26", "Feb 26"]);
  });
});

describe("MEASURES", () => {
  it("has the 8 forecast measures in crosses order", () => {
    expect(MEASURES[4]).toBe("forecastoverride");
    expect(MEASURES).toHaveLength(8);
  });
});

describe("parseForecast (enriched response)", () => {
  const enriched = {
    measures: [...MEASURES],
    buckets: [
      { name: "Jan 26", startdate: "2026-01-01", enddate: "2026-02-01" },
      { name: "Feb 26", startdate: "2026-02-01", enddate: "2026-03-01" },
    ],
    data: resp,
  };

  it("uses the server-provided measure order and bucket dates", () => {
    const { measures, buckets, series } = parseForecast(enriched);
    expect(measures[4]).toBe("forecastoverride");
    expect(buckets[0]).toEqual({
      name: "Jan 26",
      startdate: "2026-01-01",
      enddate: "2026-02-01",
    });
    expect(series).toHaveLength(2);
    expect(series[0].buckets["Jan 26"].forecastnet).toBe(10);
  });

  it("falls back to default measures/buckets when absent", () => {
    const { measures, buckets } = parseForecast({ data: resp });
    expect(measures).toEqual(MEASURES);
    expect(buckets.map((b) => b.name)).toEqual(["Jan 26", "Feb 26"]);
  });
});

describe("buildOverrideMessage", () => {
  it("emits the ForecastService payload for one cell edit", () => {
    const series = pivotForecast(resp)[0];
    const bucket = { name: "Jan 26", startdate: "2026-01-01", enddate: "2026-02-01" };
    expect(buildOverrideMessage(series, bucket, 42)).toEqual({
      item: "itemA",
      location: "loc1",
      customer: "custX",
      buckets: [
        {
          bucket: "Jan 26",
          startdate: "2026-01-01",
          enddate: "2026-02-01",
          forecastoverride: 42,
        },
      ],
    });
  });

  it("carries a null override (clearing the cell)", () => {
    const series = pivotForecast(resp)[0];
    const bucket = { name: "Feb 26", startdate: null, enddate: null };
    const msg = buildOverrideMessage(series, bucket, null);
    expect(msg.buckets[0].forecastoverride).toBeNull();
  });

  it("builds a bulk message with all edited buckets", () => {
    const series = pivotForecast(resp)[0];
    const msg = buildBulkOverrideMessage(series, [
      { bucket: { name: "Jan 26", startdate: "a", enddate: "b" }, value: 1 },
      { bucket: { name: "Feb 26", startdate: "c", enddate: "d" }, value: 2 },
    ]);
    expect(msg.item).toBe("itemA");
    expect(msg.buckets).toHaveLength(2);
    expect(msg.buckets[1]).toEqual({
      bucket: "Feb 26",
      startdate: "c",
      enddate: "d",
      forecastoverride: 2,
    });
  });
});
