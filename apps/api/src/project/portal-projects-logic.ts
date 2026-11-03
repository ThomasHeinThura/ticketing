import { daysBetween } from "./overview-logic";

/**
 * Pure rules behind the portal Project Details page (S4c; D2/D3 approved by Thomas, 31 Oct
 * 2026). No database access, so `tests/api/project/portal-projects-logic.test.ts` exercises them
 * directly.
 */

/** A project key as the portal URL carries it (`?project=KEY`, `/projects/KEY`). */
export const PORTAL_PROJECT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export type SubscriptionPeriod = {
  state: "upcoming" | "active" | "ended";
  /** Calendar days in the period, both ends included (a one-day period has 1). */
  totalDays: number;
  /** Days of the period already started, 0 before the start and `totalDays` after the end. */
  elapsedDays: number;
  /** Days left after today, never negative. */
  daysRemaining: number;
  /** `elapsedDays / totalDays`, rounded, always within 0..100. */
  elapsedPct: number;
};

/**
 * The contract period as the customer sees it. Dates are calendar days (`YYYY-MM-DD`) and
 * `today` is the UTC day, like the staff contract panel (`deriveContractState`).
 */
export function subscriptionPeriodOf(
  startDate: string,
  endDate: string,
  today: string,
): SubscriptionPeriod {
  const totalDays = Math.max(1, daysBetween(startDate, endDate) + 1);
  if (today < startDate)
    return {
      state: "upcoming",
      totalDays,
      elapsedDays: 0,
      daysRemaining: totalDays,
      elapsedPct: 0,
    };
  if (today > endDate)
    return {
      state: "ended",
      totalDays,
      elapsedDays: totalDays,
      daysRemaining: 0,
      elapsedPct: 100,
    };
  const elapsedDays = Math.min(totalDays, daysBetween(startDate, today) + 1);
  return {
    state: "active",
    totalDays,
    elapsedDays,
    daysRemaining: totalDays - elapsedDays,
    elapsedPct: Math.round((elapsedDays / totalDays) * 100),
  };
}

/**
 * The go-live milestone. The milestone table has no go-live flag and this slice adds no
 * migration, so go-live is the last milestone by date (ties: the latest created). Names are never
 * matched: a renamed milestone must not silently change the date a customer is shown.
 */
export function goLiveMilestoneOf<T extends { date: Date; createdAt: Date }>(
  milestones: readonly T[],
): T | null {
  let last: T | null = null;
  for (const milestone of milestones)
    if (
      last === null ||
      milestone.date.getTime() > last.date.getTime() ||
      (milestone.date.getTime() === last.date.getTime() &&
        milestone.createdAt.getTime() >= last.createdAt.getTime())
    )
      last = milestone;
  return last;
}
