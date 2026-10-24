import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook and automation consumers register lazily on the first default drain. A failed load
 * must neither be remembered as success nor let the drain mark parents `delivered` with an empty
 * registry: a delivered parent is never replayed (`EV-2`), so those events would be lost.
 */
const repo = vi.hoisted(() => ({
  claim: vi.fn(),
  delivered: vi.fn(),
  failed: vi.fn(),
}));

function mockRepository() {
  vi.doMock("../../../apps/api/src/events/outbox-consumer.repository", () => ({
    claimNextPendingParentEvent: repo.claim,
    markParentEventDelivered: repo.delivered,
    markParentEventFailed: repo.failed,
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../../apps/api/src/webhook/consumer");
  vi.doUnmock("../../../apps/api/src/automation/consumer");
  vi.doUnmock("../../../apps/api/src/events/outbox-consumer.repository");
  repo.claim.mockReset();
});

describe("registerBuiltInConsumers", () => {
  it("retries after a failed load and throws instead of draining with no consumers", async () => {
    vi.resetModules();
    mockRepository();
    vi.doMock("../../../apps/api/src/webhook/consumer", () => {
      throw new Error("webhook consumer failed to load");
    });
    vi.doMock("../../../apps/api/src/automation/consumer", () => ({
      automationParentConsumer: {
        name: "automation",
        handles: () => true,
        handle: vi.fn(),
      },
    }));
    const consumer = await import(
      "../../../apps/api/src/events/outbox-consumer"
    );

    await expect(consumer.registerBuiltInConsumers()).rejects.toThrow();
    // The default drain refuses to claim a parent it could not handle.
    await expect(consumer.processNextParentEvent()).rejects.toThrow();
    expect(repo.claim).not.toHaveBeenCalled();
    expect(consumer.registeredParentEventConsumers()).toHaveLength(0);

    vi.doMock("../../../apps/api/src/webhook/consumer", () => ({
      webhookParentConsumer: {
        name: "webhook",
        handles: () => true,
        handle: vi.fn(),
      },
    }));
    vi.resetModules();
    const retried = await import(
      "../../../apps/api/src/events/outbox-consumer"
    );
    await retried.registerBuiltInConsumers();
    expect(
      retried.registeredParentEventConsumers().map((entry) => entry.name),
    ).toEqual(["webhook", "automation"]);
  });

  it("loads once for concurrent callers", async () => {
    vi.resetModules();
    mockRepository();
    const loads = { webhook: 0 };
    vi.doMock("../../../apps/api/src/webhook/consumer", () => {
      loads.webhook += 1;
      return {
        webhookParentConsumer: {
          name: "webhook",
          handles: () => true,
          handle: vi.fn(),
        },
      };
    });
    vi.doMock("../../../apps/api/src/automation/consumer", () => ({
      automationParentConsumer: {
        name: "automation",
        handles: () => true,
        handle: vi.fn(),
      },
    }));
    const consumer = await import(
      "../../../apps/api/src/events/outbox-consumer"
    );
    await Promise.all([
      consumer.registerBuiltInConsumers(),
      consumer.registerBuiltInConsumers(),
      consumer.registerBuiltInConsumers(),
    ]);
    expect(loads.webhook).toBe(1);
    expect(consumer.registeredParentEventConsumers()).toHaveLength(2);
  });
});
