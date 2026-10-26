/**
 * Pure cost and capacity rules (feature-contracts-p5.md "Time and cost": TC-13, TC-18, TC-20,
 * TC-21). Integer arithmetic only: money is minor units, capacity is minutes.
 */
import { shiftDate } from "./logic";

/** TC-13: the amount of a cost entry is units x the rate captured on the row. */
export function costEntryAmountMinor(units: number, rateMinor: number): number {
  if (!Number.isInteger(units) || !Number.isInteger(rateMinor))
    throw new Error("units and rate must be integers");
  return units * rateMinor;
}

export type CommittedUnknownReason =
  | "unscheduled"
  | "nonTime"
  | "unassigned"
  | "unrated";

export type CommittedForecastTask = {
  /** The stored calendar date; null tasks cannot be assigned to any budget period. */
  dueDate: string | null;
  estimatedMinutes: number | null;
  loggedMinutes: number;
  assigneeId: string | null;
  rate: { rateMinor: number; currency: string } | null;
};

export type CommittedForecast = {
  byCurrency: Array<{
    currency: string;
    amountMinor: number;
    taskCount: number;
  }>;
  unknown: {
    taskCount: number;
    reasons: Record<CommittedUnknownReason, number>;
    /** Remaining minutes known even though one of due date, assignment or rate is missing. */
    knownRemainingMinutes: number;
  };
};

function committedAmountMinor(minutes: number, rateMinor: number): number {
  const amount = (BigInt(minutes) * BigInt(rateMinor) + 30n) / 60n;
  const safeAmount = Number(amount);
  if (!Number.isSafeInteger(safeAmount))
    throw new Error("committed amount exceeds safe integer range");
  return safeAmount;
}

/** A scalar budget-currency total exists only for a complete, single-currency forecast. */
export function committedMinorForBudget(
  forecast: CommittedForecast,
  budgetCurrency: string,
): number | null {
  if (forecast.unknown.taskCount > 0) return null;
  if (forecast.byCurrency.length === 0) return 0;
  if (
    forecast.byCurrency.length === 1 &&
    forecast.byCurrency[0]?.currency === budgetCurrency
  )
    return forecast.byCurrency[0].amountMinor;
  return null;
}

/**
 * TC-17: value only open leaf tasks due in this budget's calendar period. Missing period/date,
 * non-time estimates, missing assignees and missing current rates stay explicit unknowns.
 */
export function committedForecast(
  tasks: readonly CommittedForecastTask[],
  periodStart: string,
  periodEnd: string,
): CommittedForecast {
  const currencies = new Map<
    string,
    { currency: string; amountMinor: number; taskCount: number }
  >();
  const reasons: Record<CommittedUnknownReason, number> = {
    unscheduled: 0,
    nonTime: 0,
    unassigned: 0,
    unrated: 0,
  };
  let knownRemainingMinutes = 0;
  const markUnknown = (
    reason: CommittedUnknownReason,
    remainingMinutes: number | null,
  ) => {
    reasons[reason] += 1;
    if (remainingMinutes !== null) knownRemainingMinutes += remainingMinutes;
  };

  for (const task of tasks) {
    if (task.dueDate === null) {
      const remaining =
        task.estimatedMinutes === null
          ? null
          : Math.max(0, task.estimatedMinutes - task.loggedMinutes);
      markUnknown("unscheduled", remaining);
      continue;
    }
    if (task.dueDate < periodStart || task.dueDate > periodEnd) continue;
    if (
      task.estimatedMinutes === null ||
      !Number.isInteger(task.estimatedMinutes) ||
      task.estimatedMinutes < 0
    ) {
      markUnknown("nonTime", null);
      continue;
    }
    const remainingMinutes = Math.max(
      0,
      task.estimatedMinutes - task.loggedMinutes,
    );
    if (task.assigneeId === null) {
      markUnknown("unassigned", remainingMinutes);
      continue;
    }
    if (task.rate === null) {
      markUnknown("unrated", remainingMinutes);
      continue;
    }

    const total = currencies.get(task.rate.currency) ?? {
      currency: task.rate.currency,
      amountMinor: 0,
      taskCount: 0,
    };
    total.amountMinor += committedAmountMinor(
      remainingMinutes,
      task.rate.rateMinor,
    );
    if (!Number.isSafeInteger(total.amountMinor))
      throw new Error("committed amount exceeds safe integer range");
    total.taskCount += 1;
    currencies.set(task.rate.currency, total);
  }

  return {
    byCurrency: [...currencies.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    unknown: {
      taskCount: Object.values(reasons).reduce((sum, count) => sum + count, 0),
      reasons,
      knownRemainingMinutes,
    },
  };
}

export type CostRateSource = "entry" | "cost_type";

/**
 * The rate a new cost entry captures: the caller's explicit rate, else the cost type's default.
 * Null when neither exists (the entry cannot be priced, so it is refused rather than guessed).
 */
export function resolveCostRate(
  explicitRateMinor: number | undefined,
  typeDefaultRateMinor: number | null,
): { rateMinor: number; source: CostRateSource } | null {
  if (explicitRateMinor !== undefined)
    return { rateMinor: explicitRateMinor, source: "entry" };
  if (typeDefaultRateMinor !== null)
    return { rateMinor: typeDefaultRateMinor, source: "cost_type" };
  return null;
}

export const BUDGET_THRESHOLDS = [75, 90] as const;
export type BudgetThresholdPercent = (typeof BUDGET_THRESHOLDS)[number];

/**
 * TC-18: the thresholds the actual has reached that have not been announced for this budget.
 * Every reached-but-unannounced threshold is returned (so a jump from below 75% straight past
 * 90% records both and none fires again later); the caller notifies once, for the highest.
 */
export function newlyReachedThresholds(
  plannedMinor: number,
  actualMinor: number,
  alreadyAnnounced: ReadonlySet<number>,
): BudgetThresholdPercent[] {
  if (plannedMinor <= 0) return [];
  return BUDGET_THRESHOLDS.filter(
    (threshold) =>
      !alreadyAnnounced.has(threshold) &&
      actualMinor * 100 >= plannedMinor * threshold,
  );
}

export type AvailableHoursRow = {
  personId: string;
  minutesPerWeek: number;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
};

/**
 * TC-20: the row in force on `day` for one person: the latest `effectiveFrom` on or before the
 * day. Null when no row covers it (the caller falls back, see `availableMinutes`).
 */
export function availableHoursOn(
  rows: readonly AvailableHoursRow[],
  day: string,
): AvailableHoursRow | null {
  let best: AvailableHoursRow | null = null;
  for (const row of rows)
    if (
      row.effectiveFrom <= day &&
      (best === null || row.effectiveFrom > best.effectiveFrom)
    )
      best = row;
  return best;
}

export type AvailableMinutes = {
  minutes: number;
  /** Days of the window covered by an `available_hours` row; the rest used the fallback. */
  coveredDays: number;
  totalDays: number;
};

/**
 * TC-21: a person's available minutes in the inclusive window `[from, to]`: each day contributes
 * `minutesPerWeek / 7` of the row in force that day. Summed as `sum(minutesPerWeek)` over days
 * and divided by 7 once at the end (rounded half up), so the window total never accumulates
 * per-day rounding. Days no row covers contribute nothing here; `fallbackMinutesPerWeek` (team
 * capacity x allocation x a working day, or null) fills those days, and when both are missing the
 * result is null.
 */
export function availableMinutes(
  rows: readonly AvailableHoursRow[],
  from: string,
  to: string,
  fallbackMinutesPerWeek: number | null,
): (AvailableMinutes & { fellBack: boolean }) | null {
  let weekMinuteDays = 0;
  let coveredDays = 0;
  let totalDays = 0;
  let fellBack = false;
  for (let day = from; day <= to; day = shiftDate(day, 1)) {
    totalDays += 1;
    const row = availableHoursOn(rows, day);
    if (row) {
      weekMinuteDays += row.minutesPerWeek;
      coveredDays += 1;
    } else if (fallbackMinutesPerWeek !== null) {
      weekMinuteDays += fallbackMinutesPerWeek;
      fellBack = true;
    }
  }
  if (coveredDays === 0 && fallbackMinutesPerWeek === null) return null;
  return {
    minutes: Math.floor((weekMinuteDays + 3) / 7),
    coveredDays,
    totalDays,
    fellBack,
  };
}

/** Utilisation as a ratio of whole minutes: null when nothing is available (never a divide by zero). */
export function utilisationRatio(
  loggedMinutes: number,
  availableMinutesTotal: number | null,
): number | null {
  if (availableMinutesTotal === null || availableMinutesTotal <= 0) return null;
  return loggedMinutes / availableMinutesTotal;
}
