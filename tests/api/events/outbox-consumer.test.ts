import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  claim: vi.fn(),
  delivered: vi.fn(),
  failed: vi.fn(),
}));
vi.mock("../../../apps/api/src/events/outbox-consumer.repository", () => ({
  claimNextPendingParentEvent: repo.claim,
  markParentEventDelivered: repo.delivered,
  markParentEventFailed: repo.failed,
}));

import {
  consumersForKind,
  type ParentEventConsumer,
  parentErrorLabel,
  parentFailureOutcome,
  parseParentEnvelope,
  processNextParentEvent,
  registerParentEventConsumer,
  resetParentEventConsumersForTests,
} from "../../../apps/api/src/events/outbox-consumer";

function envelope(eventId = "evt_1", kind = "work_item.created") {
  return {
    id: eventId,
    kind,
    occurredAt: new Date(0).toISOString(),
    actor: { type: "system", id: null, name: "System" },
    scope: { workspaceId: "ws-1" },
    payload: { key: "HELP-1" },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
}

/** A fake transaction whose savepoint runs the callback and rethrows its failure. */
function fakeTx() {
  return {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ savepoint: true }),
    ),
  };
}

function claimRow(row: { attempts: number; payload?: unknown }) {
  const tx = fakeTx();
  repo.claim.mockImplementationOnce(async (process) =>
    process(tx, {
      eventId: "evt_1",
      kind: "work_item.created",
      payload: row.payload ?? envelope(),
      attempts: row.attempts,
    }),
  );
  return tx;
}

beforeEach(() => {
  repo.claim.mockReset();
  repo.delivered.mockReset();
  repo.failed.mockReset();
  resetParentEventConsumersForTests();
});

describe("parent failure transitions (retry, then dead-letter)", () => {
  it("retries the first five failures on the notification backoff schedule", () => {
    expect(parentFailureOutcome(0)).toEqual({
      state: "pending",
      attempts: 1,
      retryDelayMs: 30_000,
    });
    expect(parentFailureOutcome(1)).toMatchObject({
      state: "pending",
      attempts: 2,
      retryDelayMs: 120_000,
    });
    expect(parentFailureOutcome(4)).toMatchObject({
      state: "pending",
      attempts: 5,
      retryDelayMs: 6 * 60 * 60_000,
    });
  });

  it("dead-letters the sixth failed attempt and never exceeds the cap", () => {
    expect(parentFailureOutcome(5)).toEqual({ state: "dead", attempts: 6 });
    expect(parentFailureOutcome(9)).toEqual({ state: "dead", attempts: 6 });
  });

  it("rejects a corrupt stored attempt count", () => {
    expect(() => parentFailureOutcome(-1)).toThrow(RangeError);
    expect(() => parentFailureOutcome(1.5)).toThrow(RangeError);
  });
});

describe("envelope validation", () => {
  it("accepts the complete envelope stored for its own row", () => {
    expect(
      parseParentEnvelope({
        eventId: "evt_1",
        kind: "work_item.created",
        payload: envelope(),
      }).id,
    ).toBe("evt_1");
  });

  it("refuses a payload whose id or kind differs from the row", () => {
    expect(() =>
      parseParentEnvelope({
        eventId: "evt_2",
        kind: "work_item.created",
        payload: envelope(),
      }),
    ).toThrow("does not match");
    expect(() =>
      parseParentEnvelope({
        eventId: "evt_1",
        kind: "work_item.deleted",
        payload: envelope(),
      }),
    ).toThrow("does not match");
    expect(() =>
      parseParentEnvelope({ eventId: "evt_1", kind: "x", payload: null }),
    ).toThrow("does not match");
  });

  it("stores only a bounded error class label, never the message", () => {
    const error = new Error("secret customer content");
    error.name = "TypeError";
    expect(parentErrorLabel(error, "webhooks")).toBe("webhooks:TypeError");
    expect(parentErrorLabel("boom")).toBe("Error");
    const weird = new Error("x");
    weird.name = "has spaces and <html>";
    expect(parentErrorLabel(weird)).toBe("Error");
  });
});

describe("consumer registry", () => {
  it("selects only consumers that handle the kind", () => {
    const a: ParentEventConsumer = {
      name: "a",
      handles: (kind) => kind === "work_item.created",
      handle: vi.fn(),
    };
    const b: ParentEventConsumer = {
      name: "b",
      handles: () => false,
      handle: vi.fn(),
    };
    expect(consumersForKind("work_item.created", [a, b])).toEqual([a]);
  });

  it("refuses two consumers with the same name", () => {
    const consumer: ParentEventConsumer = {
      name: "dup",
      handles: () => true,
      handle: vi.fn(),
    };
    registerParentEventConsumer(consumer);
    expect(() => registerParentEventConsumer(consumer)).toThrow(
      "already registered",
    );
  });
});

describe("processNextParentEvent", () => {
  it("reports idle when no due pending parent exists", async () => {
    repo.claim.mockResolvedValueOnce({ kind: "idle" });
    await expect(processNextParentEvent([])).resolves.toEqual({
      kind: "idle",
    });
    expect(repo.delivered).not.toHaveBeenCalled();
  });

  it("marks a parent delivered with no registered consumers", async () => {
    const tx = claimRow({ attempts: 0 });
    await expect(processNextParentEvent([])).resolves.toEqual({
      kind: "delivered",
      eventId: "evt_1",
    });
    expect(repo.delivered).toHaveBeenCalledWith(tx, "evt_1", 0);
    expect(repo.failed).not.toHaveBeenCalled();
  });

  it("runs each matching consumer in a savepoint with the envelope keyed by event id", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const tx = claimRow({ attempts: 2 });
    await processNextParentEvent([
      { name: "webhooks", handles: () => true, handle },
    ]);
    expect(tx.transaction).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(
      { savepoint: true },
      expect.objectContaining({ id: "evt_1" }),
    );
    expect(repo.delivered).toHaveBeenCalledWith(tx, "evt_1", 2);
  });

  it("schedules a retry, not delivery, when a consumer fails", async () => {
    const tx = claimRow({ attempts: 0 });
    const result = await processNextParentEvent([
      {
        name: "webhooks",
        handles: () => true,
        handle: vi.fn().mockRejectedValue(new TypeError("x")),
      },
    ]);
    expect(result).toEqual({ kind: "retry", eventId: "evt_1" });
    expect(repo.delivered).not.toHaveBeenCalled();
    expect(repo.failed).toHaveBeenCalledWith(
      tx,
      "evt_1",
      { state: "pending", attempts: 1, retryDelayMs: 30_000 },
      "webhooks:TypeError",
    );
  });

  it("dead-letters on the final failed attempt", async () => {
    claimRow({ attempts: 5 });
    const result = await processNextParentEvent([
      {
        name: "webhooks",
        handles: () => true,
        handle: vi.fn().mockRejectedValue(new Error("x")),
      },
    ]);
    expect(result).toEqual({ kind: "dead", eventId: "evt_1" });
    expect(repo.failed).toHaveBeenCalledWith(
      expect.anything(),
      "evt_1",
      { state: "dead", attempts: 6 },
      "webhooks:Error",
    );
  });

  it("fails a corrupt envelope without running any consumer", async () => {
    const handle = vi.fn();
    claimRow({ attempts: 0, payload: { id: "other" } });
    const result = await processNextParentEvent([
      { name: "webhooks", handles: () => true, handle },
    ]);
    expect(result.kind).toBe("retry");
    expect(handle).not.toHaveBeenCalled();
    expect(repo.failed).toHaveBeenCalledWith(
      expect.anything(),
      "evt_1",
      expect.objectContaining({ attempts: 1 }),
      "ParentEnvelopeInvalid",
    );
  });
});
