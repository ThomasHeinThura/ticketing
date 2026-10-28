import type { TimeEntry } from "@/fetchers/time-tracking";
import { parseMinutes } from "@/lib/time-minutes";

/** One grid row is a work item and an activity: the cells are that pair's minutes on each day. */
export type SheetRow = {
  key: string;
  workItemId: string | null;
  workItemKey: string | null;
  workItemTitle: string | null;
  projectId: string;
  activityId: string;
  activityName: string;
};

export function rowKeyOf(workItemId: string | null, activityId: string) {
  return `${workItemId ?? "none"}|${activityId}`;
}

export function rowOf(entry: TimeEntry): SheetRow {
  return {
    key: rowKeyOf(entry.workItemId, entry.activityId),
    workItemId: entry.workItemId,
    workItemKey: entry.workItemKey,
    workItemTitle: entry.workItemTitle,
    projectId: entry.projectId,
    activityId: entry.activityId,
    activityName: entry.activityName,
  };
}

/** Rows in first-seen order (the API lists newest first, so the week reads top-down stably by key). */
export function buildRows(
  entries: readonly TimeEntry[],
  extra: readonly SheetRow[],
): SheetRow[] {
  const rows = new Map<string, SheetRow>();
  for (const entry of [...entries].sort(
    (a, b) =>
      (a.workItemKey ?? "").localeCompare(b.workItemKey ?? "") ||
      a.activityName.localeCompare(b.activityName),
  ))
    if (!rows.has(rowOf(entry).key)) rows.set(rowOf(entry).key, rowOf(entry));
  for (const row of extra) if (!rows.has(row.key)) rows.set(row.key, row);
  return [...rows.values()];
}

export function cellEntries(
  entries: readonly TimeEntry[],
  rowKey: string,
  date: string,
): TimeEntry[] {
  return entries.filter(
    (entry) => rowOf(entry).key === rowKey && entry.date === date,
  );
}

export function cellMinutes(entries: readonly TimeEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.minutes, 0);
}

export function dayTotals(
  entries: readonly TimeEntry[],
  days: readonly string[],
): number[] {
  return days.map((day) =>
    cellMinutes(entries.filter((entry) => entry.date === day)),
  );
}

export type CellAction =
  | { kind: "noop" }
  | { kind: "invalid" }
  /** More than one entry in the cell: the grid shows the total and does not edit it. */
  | { kind: "readonly" }
  | { kind: "create"; minutes: number }
  | { kind: "update"; entryId: string; minutes: number }
  /** Clearing a logged cell is a deletion, so it is requested and approved like every deletion. */
  | { kind: "delete"; entryId: string };

/** What committing `text` into a cell holding `existing` entries means. Pure, so it is pinned by tests. */
export function decideCellAction(
  existing: readonly TimeEntry[],
  text: string,
): CellAction {
  if (existing.length > 1) return { kind: "readonly" };
  const trimmed = text.trim();
  const only = existing[0];
  const cleared = trimmed === "" || trimmed === "0" || trimmed === "0:00";
  if (!only) {
    if (cleared) return { kind: "noop" };
    const minutes = parseMinutes(trimmed);
    return minutes === null ? { kind: "invalid" } : { kind: "create", minutes };
  }
  if (cleared) return { kind: "delete", entryId: only.id };
  const minutes = parseMinutes(trimmed);
  if (minutes === null) return { kind: "invalid" };
  return minutes === only.minutes
    ? { kind: "noop" }
    : { kind: "update", entryId: only.id, minutes };
}

/** Whether a day column accepts input: not in the future, and inside the backdating window. */
export function dayEditable(
  day: string,
  today: string,
  earliest: string | undefined,
): boolean {
  return day <= today && (earliest === undefined || day >= earliest);
}

export type PersonRow = {
  personId: string;
  name: string;
  byDay: number[];
  total: number;
};

/** The read-only "everyone" view: minutes per person per day. */
export function personRows(
  entries: readonly TimeEntry[],
  days: readonly string[],
): PersonRow[] {
  const people = new Map<string, PersonRow>();
  for (const entry of entries) {
    const index = days.indexOf(entry.date);
    if (index < 0) continue;
    let row = people.get(entry.personId);
    if (!row) {
      row = {
        personId: entry.personId,
        name: entry.personName ?? entry.personId,
        byDay: days.map(() => 0),
        total: 0,
      };
      people.set(entry.personId, row);
    }
    row.byDay[index] = (row.byDay[index] ?? 0) + entry.minutes;
    row.total += entry.minutes;
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}
