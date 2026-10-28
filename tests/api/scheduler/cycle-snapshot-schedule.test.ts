import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

describe("cycle snapshot schedule", () => {
  afterEach(shutdownScheduler);

  it("registers the daily snapshot handler at 00:15 UTC", () => {
    initializeScheduler();
    const job = registeredJobByName("cycle-snapshot");
    expect(job?.getPattern()).toBe("15 0 * * *");
    expect(job?.options.timezone).toBe("UTC");
    expect(typeof (job as unknown as { fn?: unknown })?.fn).toBe("function");
  });
});
