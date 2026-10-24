import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

describe("timer-sweeper schedule", () => {
  afterEach(shutdownScheduler);

  it("registers the named handler at the documented 15 minute cadence", () => {
    initializeScheduler();

    expect(registeredJobByName("timer-sweeper")?.getPattern()).toBe(
      "*/15 * * * *",
    );
    expect(
      typeof (
        registeredJobByName("timer-sweeper") as unknown as { fn?: unknown }
      )?.fn,
    ).toBe("function");
  });
});
