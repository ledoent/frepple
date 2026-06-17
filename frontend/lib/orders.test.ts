import { describe, it, expect } from "vitest";
import { canEditOrder, normalizeChange, ORDER_TABS } from "./orders";

describe("canEditOrder", () => {
  it("allows proposed/approved/confirmed, locks completed/closed", () => {
    expect(canEditOrder({ status: "proposed" })).toBe(true);
    expect(canEditOrder({ status: "confirmed" })).toBe(true);
    expect(canEditOrder({ status: "completed" })).toBe(false);
    expect(canEditOrder({ status: "closed" })).toBe(false);
  });
  it("is case-insensitive and tolerant of a missing status", () => {
    expect(canEditOrder({ status: "CLOSED" })).toBe(false);
    expect(canEditOrder({})).toBe(true);
  });
});

describe("normalizeChange", () => {
  it("expands a date-only edit to a naive midnight timestamp", () => {
    expect(normalizeChange("startdate", "2026-06-26")).toBe("2026-06-26T00:00:00");
    expect(normalizeChange("enddate", "2026-07-01")).toBe("2026-07-01T00:00:00");
  });
  it("passes a full datetime and non-date fields through unchanged", () => {
    expect(normalizeChange("startdate", "2026-06-26T08:00:00")).toBe(
      "2026-06-26T08:00:00",
    );
    expect(normalizeChange("quantity", "50")).toBe("50");
    expect(normalizeChange("status", "confirmed")).toBe("confirmed");
  });
});

describe("ORDER_TABS", () => {
  it("each tab has editable status/date/qty columns + a detail endpoint", () => {
    for (const tab of ORDER_TABS) {
      expect(tab.endpoint).toMatch(/^\/api\/input\/.+\/$/);
      const status = tab.columns.find((c) => c.key === "status");
      expect(status?.pill).toBe(true);
      expect(status?.edit).toBe("select");
      expect(tab.columns.find((c) => c.key === "quantity")?.edit).toBe("number");
    }
  });
});
