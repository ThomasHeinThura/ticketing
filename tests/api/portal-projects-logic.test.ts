import { describe, expect, it } from "vitest";
import {
  goLiveMilestoneOf,
  PORTAL_PROJECT_KEY_PATTERN,
  subscriptionPeriodOf,
} from "../../apps/api/src/project/portal-projects-logic";

describe("portal project subscription period (S4c, D3)", () => {
  it("counts both ends of the period and today as elapsed", () => {
    expect(
      subscriptionPeriodOf("2026-01-01", "2026-01-10", "2026-01-01"),
    ).toEqual({
      state: "active",
      totalDays: 10,
      elapsedDays: 1,
      daysRemaining: 9,
      elapsedPct: 10,
    });
    expect(
      subscriptionPeriodOf("2026-01-01", "2026-01-10", "2026-01-10"),
    ).toEqual({
      state: "active",
      totalDays: 10,
      elapsedDays: 10,
      daysRemaining: 0,
      elapsedPct: 100,
    });
  });

  it("handles a one-day period without dividing by zero", () => {
    expect(
      subscriptionPeriodOf("2026-03-05", "2026-03-05", "2026-03-05"),
    ).toEqual({
      state: "active",
      totalDays: 1,
      elapsedDays: 1,
      daysRemaining: 0,
      elapsedPct: 100,
    });
  });

  it("clamps before the start and after the end", () => {
    expect(
      subscriptionPeriodOf("2026-02-01", "2026-02-28", "2026-01-15"),
    ).toEqual({
      state: "upcoming",
      totalDays: 28,
      elapsedDays: 0,
      daysRemaining: 28,
      elapsedPct: 0,
    });
    expect(
      subscriptionPeriodOf("2026-02-01", "2026-02-28", "2026-03-15"),
    ).toEqual({
      state: "ended",
      totalDays: 28,
      elapsedDays: 28,
      daysRemaining: 0,
      elapsedPct: 100,
    });
  });

  it("crosses a leap day by calendar days", () => {
    expect(
      subscriptionPeriodOf("2028-02-28", "2028-03-01", "2028-02-29"),
    ).toMatchObject({ totalDays: 3, elapsedDays: 2, daysRemaining: 1 });
  });
});

describe("portal project go-live milestone", () => {
  const at = (date: string, created = "2026-01-01T00:00:00Z") => ({
    date: new Date(date),
    createdAt: new Date(created),
    name: date,
  });

  it("is the last milestone by date, ties going to the latest created", () => {
    expect(goLiveMilestoneOf([])).toBeNull();
    expect(
      goLiveMilestoneOf([at("2026-05-01"), at("2026-09-01"), at("2026-07-01")])
        ?.name,
    ).toBe("2026-09-01");
    const early = at("2026-09-01", "2026-01-01T00:00:00Z");
    const late = { ...at("2026-09-01", "2026-02-01T00:00:00Z"), name: "late" };
    expect(goLiveMilestoneOf([late, early])?.name).toBe("late");
  });
});

describe("portal project key", () => {
  it("accepts project keys and legacy slugs, rejects anything else", () => {
    for (const key of ["CON", "project-1a2b", "LEGACY_KEY"])
      expect(PORTAL_PROJECT_KEY_PATTERN.test(key)).toBe(true);
    for (const key of ["", "bad key", "a/b", "x".repeat(65), "ключ"])
      expect(PORTAL_PROJECT_KEY_PATTERN.test(key)).toBe(false);
  });
});
