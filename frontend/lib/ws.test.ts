import { describe, it, expect } from "vitest";
import { parseStatus } from "./ws";

describe("parseStatus", () => {
  it("treats null / non-percent / unknown as waiting", () => {
    expect(parseStatus(null)).toEqual({ percent: 0, state: "waiting" });
    expect(parseStatus("Waiting")).toEqual({ percent: 0, state: "waiting" });
    expect(parseStatus("queued")).toEqual({ percent: 0, state: "waiting" });
  });

  it("maps a percentage to running and clamps to 0..100", () => {
    expect(parseStatus("42%")).toEqual({ percent: 42, state: "running" });
    expect(parseStatus("0%")).toEqual({ percent: 0, state: "running" });
    expect(parseStatus("150%")).toEqual({ percent: 100, state: "running" });
    expect(parseStatus("-5%")).toEqual({ percent: 0, state: "running" });
  });

  it("recognises terminal states case-insensitively", () => {
    expect(parseStatus("Done")).toEqual({ percent: 100, state: "done" });
    expect(parseStatus("FAILED")).toEqual({ percent: 100, state: "failed" });
    expect(parseStatus("canceled")).toEqual({ percent: 100, state: "canceled" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseStatus("  55% ")).toEqual({ percent: 55, state: "running" });
    expect(parseStatus(" Done ")).toEqual({ percent: 100, state: "done" });
  });
});
