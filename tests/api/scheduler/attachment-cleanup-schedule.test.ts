import { afterEach, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

afterEach(shutdownScheduler);
it("registers hourly pending cleanup and daily 03:30 GC with real handlers", () => {
  initializeScheduler();
  for (const [name, pattern] of [
    ["attachment-pending-cleanup", "0 * * * *"],
    ["attachment-gc", "30 3 * * *"],
  ] as const) {
    const job = registeredJobByName(name);
    expect(job?.getPattern()).toBe(pattern);
    expect(typeof (job as unknown as { fn?: unknown }).fn).toBe("function");
  }
});
