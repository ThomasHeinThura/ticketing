import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

describe("report job schedules", () => {
  afterEach(shutdownScheduler);

  it("registers metrics-snapshot hourly and report-export every minute, each with a handler", () => {
    initializeScheduler();
    for (const [name, pattern] of [
      ["metrics-snapshot", "0 * * * *"],
      ["report-export", "* * * * *"],
    ] as const) {
      const job = registeredJobByName(name);
      expect(job?.getPattern(), name).toBe(pattern);
      expect(typeof (job as unknown as { fn?: unknown })?.fn).toBe("function");
    }
  });
});
