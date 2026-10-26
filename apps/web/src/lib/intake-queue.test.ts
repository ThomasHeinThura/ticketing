import { describe, expect, it } from "vitest";
import {
  formatSubmissionAge,
  matchesIntakeFilters,
  splitIntakeFilters,
} from "./intake-queue";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const row = (createdAt: string, claimedBy: string | null, typeId = "rt_1") => ({
  submission: { createdAt, claimedBy },
  requestType: { id: typeId },
});

describe("intake queue age and filters", () => {
  it("formats the age in the shortest unit", () => {
    expect(formatSubmissionAge("2026-10-23T11:48:00.000Z", NOW)).toBe("12m");
    expect(formatSubmissionAge("2026-10-23T07:00:00.000Z", NOW)).toBe("5h");
    expect(formatSubmissionAge("2026-10-20T11:00:00.000Z", NOW)).toBe("3d");
    expect(formatSubmissionAge("2026-10-24T11:00:00.000Z", NOW)).toBe("0m");
  });

  it("applies request type, assignee and age together", () => {
    const old = row("2026-10-10T00:00:00.000Z", null);
    const fresh = row("2026-10-23T11:00:00.000Z", "p1", "rt_2");
    expect(matchesIntakeFilters(old, {}, NOW)).toBe(true);
    expect(matchesIntakeFilters(old, { age: "7d" }, NOW)).toBe(true);
    expect(matchesIntakeFilters(fresh, { age: "1d" }, NOW)).toBe(false);
    expect(matchesIntakeFilters(fresh, { assignee: "unclaimed" }, NOW)).toBe(
      false,
    );
    expect(matchesIntakeFilters(fresh, { assignee: "claimed" }, NOW)).toBe(
      true,
    );
    expect(matchesIntakeFilters(old, { requestType: "rt_2" }, NOW)).toBe(false);
  });
});

describe("splitIntakeFilters (IQ-21)", () => {
  const types = [
    { id: "rt_1", key: "access" },
    { id: "rt_2", key: "vpn" },
  ];

  it("sends request type key, unclaimed and age to the server", () => {
    expect(
      splitIntakeFilters(
        { requestType: "rt_2", assignee: "unclaimed", age: "7d" },
        types,
      ),
    ).toEqual({
      server: {
        requestTypeKey: "vpn",
        assignee: "unclaimed",
        olderThanDays: 7,
      },
      residual: {},
      pending: false,
    });
  });

  it("keeps client narrowing only for what the server cannot filter", () => {
    expect(
      splitIntakeFilters({ requestType: "rt_9", assignee: "claimed" }, types),
    ).toEqual({
      server: { assignee: "claimed" },
      residual: { requestType: "rt_9" },
      pending: false,
    });
  });

  it("waits for the request type list before resolving a key", () => {
    expect(splitIntakeFilters({ requestType: "rt_1" }, undefined).pending).toBe(
      true,
    );
    expect(splitIntakeFilters({}, undefined).pending).toBe(false);
  });
});
