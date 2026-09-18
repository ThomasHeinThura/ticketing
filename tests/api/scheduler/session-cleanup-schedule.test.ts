import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

/**
 * `background-jobs.md` is the single authority for a job's cadence ("This document is the only
 * list of jobs — names are identifiers ... and are not restated anywhere else"), and its table
 * gives `session-cleanup` **daily 03:15**.
 *
 * The existing `registered-jobs.test.ts` pins *that* every registered job has a handler, which
 * is the defect it was written for. It does not pin *when* any of them fire — croner reports a
 * `nextRun()` for any valid pattern, so a job quietly moved to a different time of day passes
 * every other test in the suite.
 *
 * Every assertion here is keyed by job **name**, not by pattern. An independent review of #208
 * demonstrated why that matters: an earlier version of this file asserted the patterns as a
 * set, and transposing the two jobs' patterns still passed 8/8. A name→pattern binding is the
 * only shape that catches it.
 */
describe("session-cleanup's schedule", () => {
  afterEach(() => {
    shutdownScheduler();
  });

  it("registers session-cleanup at the daily 03:15 cadence background-jobs.md specifies", () => {
    initializeScheduler();

    expect(registeredJobByName("session-cleanup")?.getPattern()).toBe(
      "15 3 * * *",
    );
  });

  it("keeps the due-date reminders on their own cadence", () => {
    initializeScheduler();

    expect(registeredJobByName("due-date-reminders")?.getPattern()).toBe(
      "*/5 * * * *",
    );
  });

  it("does not answer for a job that was never registered", () => {
    // Guards the lookup itself: a `registeredJobByName` that returned a job for any name —
    // or a scheduler that registered one job under both names — would satisfy the two
    // assertions above while proving nothing about which handler runs when.
    initializeScheduler();

    expect(registeredJobByName("no-such-job")).toBeUndefined();
  });
});
