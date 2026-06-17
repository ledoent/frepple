import { describe, it, expect } from "vitest";
import { parseRecords, cellText, fmtDate, fmtNum } from "./records";
import type { Column } from "./records";

describe("parseRecords", () => {
  it("passes a bare DRF array through", () => {
    expect(parseRecords([{ a: 1 }, { a: 2 }])).toHaveLength(2);
  });
  it("unwraps a GridReport {rows} stream", () => {
    expect(parseRecords({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });
  it("unwraps an enriched {data:{rows}} body", () => {
    expect(parseRecords({ data: { rows: [{ a: 1 }] } })).toEqual([{ a: 1 }]);
  });
  it("degrades to [] on null/garbage", () => {
    expect(parseRecords(null)).toEqual([]);
    expect(parseRecords(undefined)).toEqual([]);
    expect(parseRecords({} as never)).toEqual([]);
  });
});

describe("cellText", () => {
  const col: Column = { key: "x", label: "X" };
  it("renders raw values and the em-dash for null/undefined", () => {
    expect(cellText(col, { x: "hi" })).toBe("hi");
    expect(cellText(col, { x: null })).toBe("—");
    expect(cellText(col, {})).toBe("—");
  });
  it("uses a column formatter when present", () => {
    const c: Column = { key: "d", label: "D", format: fmtDate };
    expect(cellText(c, { d: "2026-06-26T01:00:00" })).toBe("2026-06-26 01:00");
  });
});

describe("formatters", () => {
  it("fmtDate trims an ISO/naive datetime to minutes", () => {
    expect(fmtDate("2026-06-26 01:00:00")).toBe("2026-06-26 01:00");
    expect(fmtDate("2026-06-26T01:00:00")).toBe("2026-06-26 01:00");
    expect(fmtDate(null)).toBe("—");
  });
  it("fmtNum trims trailing zeros and handles blanks", () => {
    expect(fmtNum("50.00000000")).toBe("50");
    expect(fmtNum(12.5)).toBe("12.5");
    expect(fmtNum(null)).toBe("—");
    expect(fmtNum("")).toBe("—");
  });
});
