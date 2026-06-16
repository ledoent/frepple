import { describe, it, expect } from "vitest";
import {
  applyFill,
  applyPercent,
  applyCopyFirst,
  detectOutliers,
} from "./forecastEdit";

describe("applyFill", () => {
  it("sets every slot to the value", () => {
    expect(applyFill(7, 3)).toEqual([7, 7, 7]);
    expect(applyFill(null, 2)).toEqual([null, null]);
  });
});

describe("applyPercent", () => {
  it("scales non-null values, preserves nulls", () => {
    expect(applyPercent([100, null, 50], 10)).toEqual([110, null, 55]);
    expect(applyPercent([100], -5)).toEqual([95]);
  });
  it("rounds to avoid floating-point noise", () => {
    expect(applyPercent([10], 10)).toEqual([11]);
    expect(applyPercent([3], 33.3333)).toEqual([4]);
  });
});

describe("applyCopyFirst", () => {
  it("copies the first non-null value across the row", () => {
    expect(applyCopyFirst([null, 5, 9])).toEqual([5, 5, 5]);
    expect(applyCopyFirst([null, null])).toEqual([null, null]);
  });
});

describe("detectOutliers", () => {
  it("flags an extreme value via the IQR rule", () => {
    const flags = detectOutliers([10, 11, 9, 10, 200]);
    expect(flags[4]).toBe(true);
    expect(flags.slice(0, 4)).toEqual([false, false, false, false]);
  });
  it("flags nothing with fewer than 4 points", () => {
    expect(detectOutliers([1, 100, 2])).toEqual([false, false, false]);
  });
  it("never flags nulls", () => {
    const flags = detectOutliers([10, 11, 9, 10, null]);
    expect(flags[4]).toBe(false);
  });
  it("flags no outliers in a tight series", () => {
    expect(detectOutliers([10, 11, 9, 10, 11, 9])).toEqual(
      [false, false, false, false, false, false],
    );
  });
});
