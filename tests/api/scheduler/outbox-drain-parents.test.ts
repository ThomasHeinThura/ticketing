import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parent: vi.fn(),
  child: vi.fn(),
  runtime: {},
}));
vi.mock("../../../apps/api/src/events/outbox-consumer", () => ({
  processNextParentEvent: mocks.parent,
}));
vi.mock("../../../apps/api/src/notification/immediate-runtime", () => ({
  immediateNotificationRuntime: () => mocks.runtime,
}));
vi.mock("../../../apps/api/src/notification/outbox-drain", () => ({
  processNextNotificationDelivery: mocks.child,
}));
vi.mock("../../../apps/api/src/scheduler/outbox-drain-p4", () => ({
  drainP4Consumers: async () => ({
    webhooks: null,
    automations: null,
    degraded: false,
  }),
}));

import {
  drainOutbox,
  drainParentEvents,
  PARENT_DRAIN_LIMIT,
} from "../../../apps/api/src/scheduler/outbox-drain";

beforeEach(() => {
  mocks.parent.mockReset();
  mocks.child.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("parent envelope drain bounds", () => {
  it("stops on an idle parent queue", async () => {
    mocks.parent.mockResolvedValue({ kind: "idle" });
    await expect(drainParentEvents()).resolves.toEqual({
      processed: 0,
      delivered: 0,
      retried: 0,
      dead: 0,
      degraded: false,
    });
  });

  it("bounds a full parent backlog per run", async () => {
    mocks.parent.mockResolvedValue({ kind: "delivered", eventId: "e" });
    const outcome = await drainParentEvents();
    expect(outcome.processed).toBe(PARENT_DRAIN_LIMIT);
    expect(outcome.delivered).toBe(PARENT_DRAIN_LIMIT);
    expect(outcome.degraded).toBe(false);
  });

  it("reports retries and dead letters as a degraded run", async () => {
    mocks.parent
      .mockResolvedValueOnce({ kind: "retry", eventId: "a" })
      .mockResolvedValueOnce({ kind: "dead", eventId: "b" })
      .mockResolvedValue({ kind: "idle" });
    await expect(drainParentEvents()).resolves.toEqual({
      processed: 2,
      delivered: 0,
      retried: 1,
      dead: 1,
      degraded: true,
    });
  });

  it("stops and degrades when claiming throws", async () => {
    mocks.parent.mockRejectedValue(new Error("db down"));
    const outcome = await drainParentEvents();
    expect(outcome).toMatchObject({ processed: 0, degraded: true });
    expect(mocks.parent).toHaveBeenCalledTimes(1);
  });
});

describe("outbox-drain body", () => {
  it("drains parents and then immediate children, and surfaces either's degradation", async () => {
    const order: string[] = [];
    mocks.parent.mockImplementation(async () => {
      order.push("parent");
      return { kind: "idle" };
    });
    mocks.child.mockImplementationOnce(async () => {
      order.push("child");
      return { kind: "retry" };
    });
    mocks.child.mockImplementation(async () => {
      order.push("child");
      return { kind: "idle" };
    });
    const outcome = await drainOutbox();
    expect(order[0]).toBe("parent");
    expect(order.slice(1).every((step) => step === "child")).toBe(true);
    expect(outcome.degraded).toBe(true);
  });
});
