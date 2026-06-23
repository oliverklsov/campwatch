import { describe, it, expect } from "vitest";
import { addDays, isWeekendNight, widestWindow, freshOpenings, matchWatch } from "@/lib/alerts";
import type { Watch, Opening } from "@/lib/types";

function watch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    user_id: "u1",
    facility_id: "123",
    facility_name: "Test CG",
    start_date: "2026-07-10",
    end_date: "2026-07-12",
    sites: [],
    include_fcfs: false,
    flex_days: 0,
    weekend_only: false,
    active: true,
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("addDays", () => {
  it("adds and subtracts across month boundaries", () => {
    expect(addDays("2026-07-01", 3)).toBe("2026-07-04");
    expect(addDays("2026-07-01", -2)).toBe("2026-06-29");
  });
});

describe("isWeekendNight", () => {
  it("treats Friday and Saturday nights as weekend", () => {
    expect(isWeekendNight("2026-07-03")).toBe(true); // Fri
    expect(isWeekendNight("2026-07-04")).toBe(true); // Sat
    expect(isWeekendNight("2026-07-05")).toBe(false); // Sun
    expect(isWeekendNight("2026-07-02")).toBe(false); // Thu
  });
});

describe("widestWindow", () => {
  it("spans all watches and expands by flex_days", () => {
    const ws = [
      watch({ start_date: "2026-07-10", end_date: "2026-07-12", flex_days: 0 }),
      watch({ start_date: "2026-07-15", end_date: "2026-07-16", flex_days: 2 }),
    ];
    expect(widestWindow(ws)).toEqual({ start: "2026-07-10", end: "2026-07-18" });
  });
});

describe("freshOpenings", () => {
  const cur: Opening[] = [
    { site: "A1", date: "2026-07-10", status: "Available" },
    { site: "A2", date: "2026-07-10", status: "Available" },
  ];
  it("returns only openings absent from the previous snapshot", () => {
    const prev: [string, string, string][] = [["A1", "2026-07-10", "Available"]];
    expect(freshOpenings(prev, cur)).toEqual([{ site: "A2", date: "2026-07-10", status: "Available" }]);
  });
  it("treats a status change as fresh", () => {
    const prev: [string, string, string][] = [
      ["A1", "2026-07-10", "Open"],
      ["A2", "2026-07-10", "Available"],
    ];
    expect(freshOpenings(prev, cur)).toEqual([{ site: "A1", date: "2026-07-10", status: "Available" }]);
  });
  it("returns everything when the snapshot is empty", () => {
    expect(freshOpenings([], cur)).toHaveLength(2);
  });
});

describe("matchWatch", () => {
  const fresh: Opening[] = [
    { site: "A1", date: "2026-07-10", status: "Available" }, // Fri
    { site: "B2", date: "2026-07-11", status: "Open" }, // Sat, FCFS
    { site: "C3", date: "2026-07-04", status: "Available" }, // Sat, before base window
  ];
  it("matches Available within the date window only", () => {
    expect(matchWatch(watch(), fresh).map((o) => o.site)).toEqual(["A1"]);
  });
  it("includes FCFS 'Open' only when include_fcfs is set", () => {
    expect(matchWatch(watch({ include_fcfs: true }), fresh).map((o) => o.site).sort()).toEqual(["A1", "B2"]);
  });
  it("filters by specific sites", () => {
    expect(matchWatch(watch({ sites: ["B2"], include_fcfs: true }), fresh).map((o) => o.site)).toEqual(["B2"]);
  });
  it("widens the window by flex_days", () => {
    const m = matchWatch(watch({ flex_days: 7 }), fresh); // window [07-03, 07-19]
    expect(m.map((o) => o.site).sort()).toEqual(["A1", "C3"]);
  });
  it("keeps only Fri/Sat nights when weekend_only", () => {
    const m = matchWatch(watch({ start_date: "2026-07-04", end_date: "2026-07-11", weekend_only: true }), fresh);
    expect(m.map((o) => o.site).sort()).toEqual(["A1", "C3"]);
  });
});
