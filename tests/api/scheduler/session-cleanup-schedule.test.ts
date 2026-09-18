import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobs,
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
 * every other test in the suite. This is the assertion that makes the cadence a fact rather
 * than a comment, found missing by an independent review of #208.
 */
describe("session-cleanup's schedule", () => {
  afterEach(() => {
    shutdownScheduler();
  });

  it("is registered at the daily 03:15 cadence background-jobs.md specifies", () => {
    initializeScheduler();

    const patterns = registeredJobs().map((job) => job.getPattern());

    expect(patterns).toContain("15 3 * * *");
  });

  it("keeps the due-date reminders it shares the scheduler with", () => {
    // Cheap guard against one job's registration replacing the other's — the failure mode is
    // silent, because the scheduler would simply stop doing half its work.
    initializeScheduler();

    const patterns = registeredJobs().map((job) => job.getPattern());

    expect(patterns).toContain("*/5 * * * *");
    expect(patterns).toContain("15 3 * * *");
  });
});
