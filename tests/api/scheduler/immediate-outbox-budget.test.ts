import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  next: vi.fn(),
  assertOwned: vi.fn(),
  runtime: {},
}));
vi.mock("../../../apps/api/src/scheduler/leader-lock", () => ({
  assertJobExecutionOwned: () => mocks.assertOwned(),
}));
vi.mock("../../../apps/api/src/notification/immediate-runtime", () => ({
  immediateNotificationRuntime: () => mocks.runtime,
}));
vi.mock("../../../apps/api/src/notification/outbox-drain", () => ({
  processNextNotificationDelivery: mocks.next,
}));

import { drainImmediateNotifications } from "../../../apps/api/src/scheduler/outbox-drain";

beforeEach(() => {
  mocks.next.mockReset();
  mocks.assertOwned.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());
describe("immediate child worker bounds", () => {
  it("stops on an idle queue", async () => {
    mocks.next.mockResolvedValue({ kind: "idle" });
    await expect(drainImmediateNotifications()).resolves.toEqual({
      processed: 0,
      degraded: false,
    });
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });
  it("bounds a full backlog to one hundred attempts per run", async () => {
    mocks.next.mockResolvedValue({ kind: "delivered" });
    await expect(drainImmediateNotifications()).resolves.toEqual({
      processed: 100,
      degraded: false,
    });
    expect(mocks.next).toHaveBeenCalledTimes(100);
  });
  it("stops starting further work after the time budget", async () => {
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValue(20001);
    mocks.next.mockResolvedValue({ kind: "retry" });
    await expect(drainImmediateNotifications()).resolves.toEqual({
      processed: 1,
      degraded: true,
    });
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });

  it("checks ownership before each next independently claimed delivery", async () => {
    mocks.assertOwned
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("reservation lost"));
    mocks.next.mockResolvedValue({ kind: "delivered" });
    await expect(drainImmediateNotifications()).rejects.toThrow(
      "reservation lost",
    );
    expect(mocks.next).toHaveBeenCalledOnce();
  });
});
