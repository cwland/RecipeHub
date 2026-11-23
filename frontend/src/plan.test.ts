import { describe, expect, it } from "vitest";
import { monthGrid, monthLabel, weekdayLetters } from "./plan";

describe("monthGrid: the weeks a month calendar shows", () => {
  it("Monday start: November 2026 runs Oct 26 – Dec 6, six whole weeks", () => {
    const g = monthGrid("2026-11-22", 1);
    expect(g).toHaveLength(6);
    expect(g[0]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(g[5][6]).toBe("2026-12-06");
    for (const w of g) expect(w).toHaveLength(7);
  });

  it("Sunday start: November 2026 runs Nov 1 – Dec 5, five weeks", () => {
    const g = monthGrid("2026-11-22", 0);
    expect(g).toHaveLength(5);
    expect(g[0][0]).toBe("2026-11-01");
    expect(g[4][6]).toBe("2026-12-05");
  });

  it("leap February has the 29th; a February starting on the week's first day fills exactly four weeks", () => {
    expect(monthGrid("2028-02-10", 1).flat()).toContain("2028-02-29");
    const feb = monthGrid("2026-02-10", 0);
    expect(feb).toHaveLength(4);
    expect(feb[0][0]).toBe("2026-02-01");
    expect(feb[3][6]).toBe("2026-02-28");
  });
});

describe("month labels and weekday letters", () => {
  it("names the month and year", () => {
    expect(monthLabel("2026-11-22")).toMatch(/November/);
    expect(monthLabel("2026-11-22")).toMatch(/2026/);
  });
  it("weekday letters follow the week start", () => {
    expect(weekdayLetters(1)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    expect(weekdayLetters(0)).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
  });
});
