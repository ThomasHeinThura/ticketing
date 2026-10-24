import { sweepExpiredTimers } from "../time-tracking/repository";
import { withJobLease } from "./leader-lock";

export const TIMER_SWEEPER_JOB = "timer-sweeper";
const LEASE_MS = 5 * 60_000;

export type TimerSweeperOutcome = {
  swept: number;
  degraded: boolean;
};

/**
 * `timer-sweeper` (background-jobs.md, every 15 minutes, 5 minute lease): stops every
 * `running_timer` older than 12 hours into a capped, `needs_review` time entry written as a system
 * actor, so a timer left running overnight asks its owner what actually happened on the next
 * visit. Each timer is closed in its own transaction with `FOR UPDATE SKIP LOCKED`, so a replica
 * that loses the race (or a person stopping their own timer) never double-records.
 */
export async function runTimerSweeper(): Promise<TimerSweeperOutcome> {
  return withJobLease(
    TIMER_SWEEPER_JOB,
    async () => {
      const { swept, failed } = await sweepExpiredTimers();
      return { swept, degraded: failed > 0 };
    },
    () => ({ swept: 0, degraded: false }),
    LEASE_MS,
  );
}
