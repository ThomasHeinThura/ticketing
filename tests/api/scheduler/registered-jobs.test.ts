import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobs,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

/**
 * Regression guard.
 *
 * Removing kaneo's `project-webhook-reminders` job left this behind:
 *
 *     jobs.push(new Cron(pattern));   // no handler
 *
 * A schedule with no handler. It compiled, type-checked, and the whole suite
 * stayed green — nothing asserted what the scheduler registers. croner reports
 * a `nextRun()` for a handler-less job exactly as it does for a real one, so it
 * looked alive while firing into nothing every five minutes.
 *
 * These tests make that shape impossible to ship again.
 */
describe("scheduler registration", () => {
  afterEach(() => {
    shutdownScheduler();
  });

  it("registers at least one job", () => {
    initializeScheduler();

    expect(registeredJobs().length).toBeGreaterThan(0);
  });

  it("gives every registered job a handler", () => {
    initializeScheduler();

    for (const job of registeredJobs()) {
      // croner exposes the callback as `fn`; it is undefined when a Cron was
      // constructed with a pattern but no handler.
      expect(typeof (job as unknown as { fn?: unknown }).fn).toBe("function");
    }
  });

  it("gives every registered job a schedule it will actually run on", () => {
    initializeScheduler();

    for (const job of registeredJobs()) {
      expect(job.nextRun()).toBeInstanceOf(Date);
    }
  });
});
