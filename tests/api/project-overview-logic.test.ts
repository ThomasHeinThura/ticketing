import { describe, expect, it } from "vitest";
import {
  CONTRACT_EXPIRING_DAYS,
  countsFromGroups,
  daysBetween,
  deriveContractState,
  hourBankOf,
  isPastDay,
  utcToday,
} from "../../apps/api/src/project/overview-logic";

describe("project overview logic (0213, D2)", () => {
  it("counts calendar days between ISO dates", () => {
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-10-31", "2026-10-31")).toBe(0);
    expect(daysBetween("2026-11-01", "2026-10-31")).toBe(-1);
    expect(utcToday(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-31");
  });

  it("marks a dated item overdue only once its due day has passed (UTC days)", () => {
    const due = new Date("2026-11-05T00:00:00.000Z");
    // The whole due day is on time, including its first and last instants.
    expect(isPastDay(due, new Date("2026-11-05T00:00:00.000Z"))).toBe(false);
    expect(isPastDay(due, new Date("2026-11-05T12:00:00.000Z"))).toBe(false);
    expect(isPastDay(due, new Date("2026-11-05T23:59:59.999Z"))).toBe(false);
    expect(isPastDay(due, new Date("2026-11-06T00:00:00.000Z"))).toBe(true);
    expect(isPastDay("2026-11-04", new Date("2026-11-05T00:00:00.000Z"))).toBe(
      true,
    );
    expect(isPastDay("2026-11-06", new Date("2026-11-05T00:00:00.000Z"))).toBe(
      false,
    );
  });

  it("derives the contract state in order: none, expired, kickoff pending, expiring, active", () => {
    const today = "2026-10-31";
    expect(deriveContractState(null, today)).toBe("none");
    expect(
      deriveContractState(
        { endDate: "2026-10-30", kickoffStatus: "completed" },
        today,
      ),
    ).toBe("expired");
    // An expired contract is expired even when kickoff never happened.
    expect(
      deriveContractState(
        { endDate: "2026-10-30", kickoffStatus: "pending" },
        today,
      ),
    ).toBe("expired");
    expect(
      deriveContractState(
        { endDate: "2027-10-31", kickoffStatus: "scheduled" },
        today,
      ),
    ).toBe("kickoff_pending");
    expect(
      deriveContractState(
        { endDate: "2026-11-30", kickoffStatus: "completed" },
        today,
      ),
    ).toBe("expiring");
    expect(CONTRACT_EXPIRING_DAYS).toBe(30);
    expect(
      deriveContractState(
        { endDate: "2026-12-01", kickoffStatus: "completed" },
        today,
      ),
    ).toBe("active");
    // The last day of the contract is still inside it.
    expect(
      deriveContractState(
        { endDate: "2026-10-31", kickoffStatus: "completed" },
        today,
      ),
    ).toBe("expiring");
  });

  it("computes the hour bank, including an overdrawn bank", () => {
    expect(hourBankOf(600, 210)).toEqual({
      contractedMinutes: 600,
      usedMinutes: 210,
      remainingMinutes: 390,
      usedPct: 35,
    });
    expect(hourBankOf(60, 90)).toEqual({
      contractedMinutes: 60,
      usedMinutes: 90,
      remainingMinutes: -30,
      usedPct: 150,
    });
    expect(hourBankOf(0, 0).usedPct).toBe(0);
  });

  it("derives open, breached, in progress, waiting and done/total from state groups", () => {
    expect(
      countsFromGroups([
        { group: "backlog", items: 2, breached: 1, waiting: 0 },
        { group: "unstarted", items: 1, breached: 0, waiting: 1 },
        { group: "started", items: 3, breached: 1, waiting: 1 },
        { group: "completed", items: 4, breached: 2, waiting: 0 },
        { group: "cancelled", items: 5, breached: 0, waiting: 0 },
        { group: "unknown", items: 9, breached: 9, waiting: 9 },
      ]),
    ).toEqual({
      open: 6,
      breached: 2,
      waiting: 2,
      inProgress: 2,
      done: 4,
      total: 10,
    });
    expect(countsFromGroups([])).toEqual({
      open: 0,
      breached: 0,
      waiting: 0,
      inProgress: 0,
      done: 0,
      total: 0,
    });
  });
});
