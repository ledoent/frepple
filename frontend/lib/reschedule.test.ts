import { describe, it, expect } from "vitest";
import {
  rescheduleEndpoint,
  isReschedulable,
  shiftEngineDate,
} from "./reschedule";

describe("rescheduleEndpoint", () => {
  it("maps each operationplan type to its DRF detail endpoint", () => {
    expect(rescheduleEndpoint("MO")).toBe("manufacturingorder");
    expect(rescheduleEndpoint("WO")).toBe("workorder");
    expect(rescheduleEndpoint("PO")).toBe("purchaseorder");
    expect(rescheduleEndpoint("DO")).toBe("distributionorder");
    expect(rescheduleEndpoint("DLVR")).toBe("deliveryorder");
  });

  it("returns null for non-reschedulable types (e.g. stock)", () => {
    expect(rescheduleEndpoint("STCK")).toBeNull();
    expect(rescheduleEndpoint("")).toBeNull();
  });
});

describe("isReschedulable", () => {
  it("allows proposed/approved/confirmed orders of a known type", () => {
    expect(isReschedulable("MO", "proposed")).toBe(true);
    expect(isReschedulable("PO", "confirmed")).toBe(true);
    expect(isReschedulable("DLVR", "approved")).toBe(true);
  });

  it("locks executed orders and unknown types", () => {
    expect(isReschedulable("MO", "completed")).toBe(false);
    expect(isReschedulable("MO", "closed")).toBe(false);
    expect(isReschedulable("STCK", "proposed")).toBe(false);
  });

  it("is case-insensitive on status", () => {
    expect(isReschedulable("MO", "COMPLETED")).toBe(false);
  });
});

describe("shiftEngineDate", () => {
  const DAY = 86_400_000;

  it("shifts a naive engine timestamp and returns a naive ISO string", () => {
    // +1 day from 2026-06-26 01:00:00
    expect(shiftEngineDate("2026-06-26 01:00:00", DAY)).toBe(
      "2026-06-27T01:00:00",
    );
  });

  it("shifts backwards and preserves time-of-day", () => {
    expect(shiftEngineDate("2026-06-26 09:30:15", -2 * DAY)).toBe(
      "2026-06-24T09:30:15",
    );
  });

  it("accepts an already-ISO input too", () => {
    expect(shiftEngineDate("2026-06-26T00:00:00", DAY)).toBe(
      "2026-06-27T00:00:00",
    );
  });

  it("returns null for an unparseable date", () => {
    expect(shiftEngineDate("", DAY)).toBeNull();
    expect(shiftEngineDate("not-a-date", DAY)).toBeNull();
  });
});
