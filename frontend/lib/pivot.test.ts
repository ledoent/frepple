import { describe, it, expect } from "vitest";
import { pivotRows, bucketOrder, parsePivot } from "./pivot";

describe("pivotRows", () => {
  it("splits scalar fields from per-bucket measure arrays", () => {
    const rows = [{ item: "A", location: "L", Jan: [1, 2], Feb: [3, 4] }];
    const s = pivotRows({ rows }, ["startoh", "endoh"], "item");
    expect(s).toHaveLength(1);
    expect(s[0].key).toBe("A");
    expect(s[0].fields).toEqual({ item: "A", location: "L" });
    expect(s[0].buckets.Jan).toEqual({ startoh: 1, endoh: 2 });
    expect(s[0].buckets.Feb).toEqual({ startoh: 3, endoh: 4 });
  });

  it("maps missing/null slots to null and coerces numeric strings", () => {
    const s = pivotRows({ rows: [{ k: "x", B: ["5", null] }] }, ["a", "b"], "k");
    expect(s[0].buckets.B).toEqual({ a: 5, b: null });
  });

  it("returns [] for empty/absent rows (no truncation)", () => {
    expect(pivotRows({}, ["a"], "k")).toEqual([]);
    expect(pivotRows({ rows: [] }, ["a"], "k")).toEqual([]);
  });

  it("uses '' as key when the key field is absent", () => {
    const s = pivotRows({ rows: [{ other: "z", B: [1] }] }, ["a"], "missing");
    expect(s[0].key).toBe("");
  });
});

describe("bucketOrder", () => {
  it("unions bucket names across series in first-seen order", () => {
    const s = pivotRows(
      {
        rows: [
          { k: "1", Jan: [1], Feb: [1] },
          { k: "2", Feb: [1], Mar: [1] },
        ],
      },
      ["a"],
      "k",
    );
    expect(bucketOrder(s)).toEqual(["Jan", "Feb", "Mar"]);
  });
});

describe("parsePivot", () => {
  it("uses envelope measures + buckets when present", () => {
    const env = {
      measures: ["a", "b"],
      buckets: [{ name: "Jan", startdate: "2026-01-01", enddate: "2026-02-01" }],
      data: { rows: [{ k: "x", Jan: [10, 20] }] },
    };
    const { measures, buckets, series } = parsePivot(env, { keyField: "k" });
    expect(measures).toEqual(["a", "b"]);
    expect(buckets[0].name).toBe("Jan");
    expect(series[0].buckets.Jan).toEqual({ a: 10, b: 20 });
  });

  it("falls back to fallbackMeasures + derived buckets when omitted", () => {
    const { measures, buckets } = parsePivot(
      { data: { rows: [{ k: "x", Jan: [1] }] } },
      { keyField: "k", fallbackMeasures: ["a"] },
    );
    expect(measures).toEqual(["a"]);
    expect(buckets).toEqual([{ name: "Jan", startdate: null, enddate: null }]);
  });
});
