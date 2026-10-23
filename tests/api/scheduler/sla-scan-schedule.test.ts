import { afterEach, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

afterEach(shutdownScheduler);
it("registers sla-scan with a real handler every five minutes", () => {
  initializeScheduler();
  const job = registeredJobByName("sla-scan");
  expect(job?.getPattern()).toBe("*/5 * * * *");
  expect(typeof (job as unknown as { fn?: unknown }).fn).toBe("function");
  expect(job?.nextRun()).toBeInstanceOf(Date);
});
