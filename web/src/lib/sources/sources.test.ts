import { describe, it, expect } from "vitest";
import { parseUsedirectId, makeUsedirectId, isUsedirectId } from "@/lib/sources/usedirect";
import { parseCamisId, makeCamisId, isCamisId } from "@/lib/sources/camis";
import { sourceOf, aggregate } from "@/lib/sources";

describe("usedirect ids", () => {
  it("round-trips", () => {
    expect(makeUsedirectId("CA", "708")).toBe("ued-ca-708");
    expect(parseUsedirectId("ued-ca-708")).toEqual({ state: "ca", facilityId: "708" });
  });
  it("recognizes and rejects", () => {
    expect(isUsedirectId("ued-ca-708")).toBe(true);
    expect(isUsedirectId("10300375")).toBe(false);
    expect(parseUsedirectId("10300375")).toBeNull();
  });
});

describe("camis ids", () => {
  it("round-trips with negative map ids", () => {
    expect(makeCamisId("WA", -2147483396)).toBe("camis-wa--2147483396");
    expect(parseCamisId("camis-wa--2147483396")).toEqual({ tenant: "wa", mapId: -2147483396 });
  });
  it("recognizes and rejects", () => {
    expect(isCamisId("camis-wa--2147483396")).toBe(true);
    expect(isCamisId("ued-ca-708")).toBe(false);
    expect(parseCamisId("nope")).toBeNull();
  });
});

describe("sourceOf", () => {
  it("classifies ids by prefix", () => {
    expect(sourceOf("10300375")).toBe("recreation.gov");
    expect(sourceOf("ued-ca-708")).toBe("usedirect");
    expect(sourceOf("camis-wa--2147483396")).toBe("camis");
  });
});

describe("aggregate", () => {
  it("counts site-nights, distinct sites, and per-date status", () => {
    const r = aggregate("123", "2026-07-10", "2026-07-12", [
      { site: "A1", date: "2026-07-10", status: "Available" },
      { site: "A2", date: "2026-07-10", status: "Available" },
      { site: "B1", date: "2026-07-11", status: "Open" },
    ]);
    expect(r.totalOpenings).toBe(3);
    expect(r.bookable).toBe(2);
    expect(r.fcfs).toBe(1);
    expect(r.bookableSites).toBe(2);
    expect(r.openSites).toBe(1);
    expect(r.siteNightDates).toEqual([
      { date: "2026-07-10", count: 2, status: "Available" },
      { date: "2026-07-11", count: 1, status: "Open" },
    ]);
  });
});
