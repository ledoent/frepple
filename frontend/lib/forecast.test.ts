import { describe, it, expect } from "vitest";
import { pivotForecast, bucketNames, MEASURES } from "./forecast";

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
