import { describe, expect, it } from "vitest";
import type { TimeEntry } from "@/fetchers/time-tracking";
import {
  buildRows,
  cellEntries,
  cellMinutes,
  dayEditable,
  dayTotals,
  decideCellAction,
  personRows,
  rowKeyOf,
} from "./timesheet-model";

function entry(over: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "e1",
    workspaceId: "w",
    projectId: "p",
    workItemId: "wi1",
    workItemKey: "HELP-1",
    workItemTitle: "One",
    personId: "me",
    personName: "Me",
    date: "2026-10-19",
    minutes: 60,
    activityId: "dev",
    activityName: "Development",
    description: null,
    billable: true,
    source: "manual",
    needsReview: false,
    createdAt: "2026-10-19T08:00:00Z",
    updatedAt: "2026-10-19T08:00:00Z",
    ...over,
  };
}

describe("grid model", () => {
  const entries = [
    entry({ id: "a", date: "2026-10-19", minutes: 60 }),
    entry({ id: "b", date: "2026-10-20", minutes: 30 }),
    entry({
      id: "c",
      date: "2026-10-20",
      minutes: 15,
      activityId: "sup",
      activityName: "Support",
    }),
    entry({
      id: "d",
      date: "2026-10-20",
      minutes: 45,
      workItemId: "wi2",
      workItemKey: "HELP-2",
    }),
  ];
  const days = ["2026-10-19", "2026-10-20", "2026-10-21"];

  it("makes one row per work item and activity, plus the rows added by hand", () => {
    const rows = buildRows(entries, [
      {
        key: rowKeyOf("wi3", "dev"),
        workItemId: "wi3",
        workItemKey: "HELP-3",
        workItemTitle: "Three",
        projectId: "p",
        activityId: "dev",
        activityName: "Development",
      },
    ]);
    expect(rows.map((row) => row.key)).toEqual([
      "wi1|dev",
      "wi1|sup",
      "wi2|dev",
      "wi3|dev",
    ]);
  });

  it("does not duplicate an added row that already has entries", () => {
    const rows = buildRows(entries, [
      {
        key: "wi1|dev",
        workItemId: "wi1",
        workItemKey: "HELP-1",
        workItemTitle: "One",
        projectId: "p",
        activityId: "dev",
        activityName: "Development",
      },
    ]);
    expect(rows).toHaveLength(3);
  });

  it("sums whole minutes per cell and per day with no floating point", () => {
    expect(cellMinutes(cellEntries(entries, "wi1|dev", "2026-10-20"))).toBe(30);
    expect(dayTotals(entries, days)).toEqual([60, 90, 0]);
    expect(dayTotals(entries, days).every(Number.isInteger)).toBe(true);
  });

  it("lists minutes per person per day for the everyone view", () => {
    const rows = personRows(
      [entry({ personId: "z", personName: "Zed", minutes: 20 }), ...entries],
      days,
    );
    expect(rows.map((row) => [row.name, row.total])).toEqual([
      ["Me", 150],
      ["Zed", 20],
    ]);
  });
});

describe("committing a cell", () => {
  it("creates an entry in an empty cell and ignores an empty commit", () => {
    expect(decideCellAction([], "1h30")).toEqual({
      kind: "create",
      minutes: 90,
    });
    expect(decideCellAction([], "")).toEqual({ kind: "noop" });
    expect(decideCellAction([], "0")).toEqual({ kind: "noop" });
  });

  it("updates a single entry and leaves an unchanged value alone", () => {
    const single = [entry({ id: "x", minutes: 60 })];
    expect(decideCellAction(single, "2:00")).toEqual({
      kind: "update",
      entryId: "x",
      minutes: 120,
    });
    expect(decideCellAction(single, "60")).toEqual({ kind: "noop" });
    expect(decideCellAction(single, "1:00")).toEqual({ kind: "noop" });
  });

  it("turns clearing a logged cell into a deletion request", () => {
    expect(decideCellAction([entry({ id: "x" })], "")).toEqual({
      kind: "delete",
      entryId: "x",
    });
    expect(decideCellAction([entry({ id: "x" })], "0")).toEqual({
      kind: "delete",
      entryId: "x",
    });
  });

  it("refuses text that is not a duration", () => {
    expect(decideCellAction([], "abc")).toEqual({ kind: "invalid" });
    expect(decideCellAction([entry()], "26h")).toEqual({ kind: "invalid" });
    expect(decideCellAction([], "1441")).toEqual({ kind: "invalid" });
  });

  it("does not edit a cell that holds several entries", () => {
    expect(
      decideCellAction([entry({ id: "a" }), entry({ id: "b" })], "30"),
    ).toEqual({ kind: "readonly" });
  });
});

describe("which days take input", () => {
  it("allows today and the backdating window, not the future or beyond the limit", () => {
    expect(dayEditable("2026-10-24", "2026-10-24", "2026-09-24")).toBe(true);
    expect(dayEditable("2026-09-24", "2026-10-24", "2026-09-24")).toBe(true);
    expect(dayEditable("2026-09-23", "2026-10-24", "2026-09-24")).toBe(false);
    expect(dayEditable("2026-10-25", "2026-10-24", "2026-09-24")).toBe(false);
    expect(dayEditable("2020-01-01", "2026-10-24", undefined)).toBe(true);
  });
});
