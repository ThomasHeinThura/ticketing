import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

describe("notification-digest's schedule", () => {
  afterEach(() => {
    shutdownScheduler();
  });

  it("registers notification-digest hourly, as background-jobs.md specifies", () => {
    initializeScheduler();
    expect(registeredJobByName("notification-digest")?.getPattern()).toBe(
      "0 * * * *",
    );
  });
});
