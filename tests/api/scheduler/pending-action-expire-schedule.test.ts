import { afterEach, describe, expect, it } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

describe("pending-action-expire schedule", () => {
  afterEach(shutdownScheduler);

  it("registers the named handler at the documented one-minute cadence", () => {
    initializeScheduler();

    expect(registeredJobByName("pending-action-expire")?.getPattern()).toBe(
      "* * * * *",
    );
    expect(
      typeof (
        registeredJobByName("pending-action-expire") as unknown as {
          fn?: unknown;
        }
      )?.fn,
    ).toBe("function");
  });
});
