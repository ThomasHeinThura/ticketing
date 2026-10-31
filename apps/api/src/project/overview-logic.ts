/**
 * Pure rules behind the project Overview (0213; decisions D1/D2). No database access, so the
 * unit tests in `tests/api/project-overview-logic.test.ts` exercise them directly.
 */
export const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "closed",
] as const;
export const CONTRACT_COVERAGES = ["9x5", "12x5", "24x7"] as const;
export const KICKOFF_STATUSES = ["pending", "scheduled", "completed"] as const;
/** Inclusive "expiring" window: a contract with this many days left or fewer is expiring. */
export const CONTRACT_EXPIRING_DAYS = 30;
export function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * True once a dated item's calendar day (`YYYY-MM-DD`, taken in UTC) is before today's UTC day.
 * Due dates are stored as midnight UTC, so comparing instants would mark an item overdue for
 * its whole due day; comparing calendar days keeps it on time until the day has passed.
 */
export function isPastDay(date: Date | string, now: Date): boolean {
  const day = typeof date === "string" ? date.slice(0, 10) : utcToday(date);
  return day < utcToday(now);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/** D2's derived state. Exported for unit tests. */
export function deriveContractState(
  contract: { endDate: string; kickoffStatus: string } | null,
  today: string,
): "none" | "expired" | "kickoff_pending" | "expiring" | "active" {
  if (!contract) return "none";
  const left = daysBetween(today, contract.endDate);
  if (left < 0) return "expired";
  if (contract.kickoffStatus !== "completed") return "kickoff_pending";
  if (left <= CONTRACT_EXPIRING_DAYS) return "expiring";
  return "active";
}

/** Hour bank arithmetic. Exported for unit tests. */
export function hourBankOf(contractedMinutes: number, usedMinutes: number) {
  return {
    contractedMinutes,
    usedMinutes,
    remainingMinutes: contractedMinutes - usedMinutes,
    usedPct:
      contractedMinutes > 0
        ? Math.round((usedMinutes / contractedMinutes) * 100)
        : 0,
  };
}

const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
type StateGroup = (typeof STATE_GROUPS)[number];

/** Overview counts from per-state-group rows. Exported for unit tests. */
export function countsFromGroups(
  rows: Array<{
    group: string;
    items: number;
    breached: number;
    waiting: number;
  }>,
) {
  const byGroup = new Map<StateGroup, (typeof rows)[number]>();
  for (const row of rows)
    if ((STATE_GROUPS as readonly string[]).includes(row.group))
      byGroup.set(row.group as StateGroup, row);
  const get = (group: StateGroup) =>
    byGroup.get(group) ?? { group, items: 0, breached: 0, waiting: 0 };
  const open = (["backlog", "unstarted", "started"] as const).map(get);
  const started = get("started");
  const completed = get("completed");
  return {
    open: open.reduce((sum, row) => sum + row.items, 0),
    breached: open.reduce((sum, row) => sum + row.breached, 0),
    waiting: open.reduce((sum, row) => sum + row.waiting, 0),
    inProgress: started.items - started.waiting,
    done: completed.items,
    total: open.reduce((sum, row) => sum + row.items, 0) + completed.items,
  };
}
