import { describe, it, expect } from "vitest";
import {
  parsePegging,
  fractionOf,
  parseEngineDate,
  axisTicks,
} from "./pegging";

const SAMPLE = {
  window: {
    start: "2026-05-28T00:00:00",
    end: "2026-07-06T00:00:00",
    due: "2026-06-17T00:00:00",
    current: "2026-06-17T00:00:00",
  },
  data: {
    total: 1,
    rows: [
      {
        id: "product/39",
        depth: "1",
        operation: "Ship product @ factory 1",
        type: "DLVR",
        item: "product",
        quantity: "100.0",
        operationplans: [
          {
            reference: "39",
            operation: "Ship product @ factory 1",
            quantity: "50.00000000",
            startdate: "2026-06-26 01:00:00",
            enddate: "2026-06-26 01:00:00",
            status: "proposed",
            type: "DLVR",
            color: null,
            criticality: 0,
            item: "product",
            location: "factory 1",
          },
        ],
      },
    ],
  },
};

describe("parsePegging", () => {
  it("parses the window + tree rows + bars with numeric coercion", () => {
    const p = parsePegging(SAMPLE);
    expect(p.window.start).toBe("2026-05-28T00:00:00");
    expect(p.window.due).toBe("2026-06-17T00:00:00");
    expect(p.rows).toHaveLength(1);
    const row = p.rows[0];
    expect(row.depth).toBe(1); // "1" -> 1
    expect(row.quantity).toBe(100);
    expect(row.type).toBe("DLVR");
    expect(row.bars).toHaveLength(1);
    expect(row.bars[0].reference).toBe("39");
    expect(row.bars[0].quantity).toBe(50);
    expect(row.bars[0].status).toBe("proposed");
    expect(row.bars[0].color).toBeNull();
  });

  it("degrades to an empty tree on null/legacy bodies (no plan yet)", () => {
    expect(parsePegging(null).rows).toEqual([]);
    expect(parsePegging(undefined).window.start).toBeNull();
    expect(parsePegging({ total: 0 } as never).rows).toEqual([]);
  });
});

describe("fractionOf", () => {
  const startMs = parseEngineDate("2026-05-28T00:00:00");
  const endMs = parseEngineDate("2026-07-06T00:00:00");

  it("places a date as a 0..1 fraction of the window", () => {
    // due (Jun 17) is partway through May28..Jul6
    const f = fractionOf("2026-06-17T00:00:00", startMs, endMs)!;
    expect(f).toBeGreaterThan(0.4);
    expect(f).toBeLessThan(0.6);
  });

  it("handles the engine's space-separated naive timestamps", () => {
    const f = fractionOf("2026-06-26 01:00:00", startMs, endMs)!;
    expect(f).toBeGreaterThan(0.7);
    expect(f).toBeLessThan(0.8);
  });

  it("clamps out-of-window dates and rejects a degenerate window", () => {
    expect(fractionOf("2020-01-01T00:00:00", startMs, endMs)).toBe(0);
    expect(fractionOf("2030-01-01T00:00:00", startMs, endMs)).toBe(1);
    expect(fractionOf("2026-06-01T00:00:00", endMs, startMs)).toBeNull();
    expect(fractionOf("", startMs, endMs)).toBeNull();
  });
});

describe("axisTicks", () => {
  it("returns day-snapped ticks across the window", () => {
    const ticks = axisTicks(SAMPLE.window, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(ticks[0].fraction).toBe(0);
    expect(ticks[ticks.length - 1].fraction).toBeLessThanOrEqual(1);
    expect(typeof ticks[0].label).toBe("string");
  });

  it("returns no ticks for a degenerate/empty window", () => {
    expect(axisTicks({ start: null, end: null, due: null, current: null })).toEqual(
      [],
    );
  });
});
