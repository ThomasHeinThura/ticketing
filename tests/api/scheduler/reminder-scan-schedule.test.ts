import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

describe("reminder-scan schedule", () => {
  afterEach(shutdownScheduler);

  it("registers the approval lifecycle handler at the documented cadence", () => {
    initializeScheduler();
    const job = registeredJobByName("reminder-scan");
    expect(job?.getPattern()).toBe("*/15 * * * *");
    expect(typeof (job as unknown as { fn?: unknown })?.fn).toBe("function");
  });
});
