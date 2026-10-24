import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  lockRecipientPerson: vi.fn(),
  insertEventInboxRow: vi.fn(),
  insertPendingDelivery: vi.fn(),
}));
const prefs = vi.hoisted(() => ({ resolveNotificationPreference: vi.fn() }));
vi.mock("../../../apps/api/src/notification/fanout.repository", () => repo);
vi.mock("../../../apps/api/src/notification/preferences", () => prefs);

import type {
  DbTransaction,
  DomainEventEnvelope,
} from "../../../apps/api/src/events/outbox";
import { materializeNotificationFanout } from "../../../apps/api/src/notification/fanout";

const tx = {} as DbTransaction;

function event(kind: string, actorId: string | null) {
  return {
    id: `event-${kind}`,
    kind,
    occurredAt: "2026-01-15T10:00:00.000Z",
    actor: { type: "person", id: actorId, name: "Actor" },
    scope: { workspaceId: "ws-1", organisationId: "org-1" },
    payload: {},
    causationId: null,
    depth: 0,
    originAutomationId: null,
  } as DomainEventEnvelope<Record<string, unknown>>;
}

const candidate = (personId: string) => ({
  personId,
  resourceType: "work_item",
  resourceId: "item-1",
  title: "Title",
  body: "Body",
  channels: ["notify.email"],
});

beforeEach(() => {
  vi.clearAllMocks();
  repo.lockRecipientPerson.mockResolvedValue({ userId: "u", active: true });
  prefs.resolveNotificationPreference.mockResolvedValue({
    enabled: true,
    digest: "daily",
    source: "global",
  });
});

describe("NO-4 you are never notified about your own action", () => {
  it("creates no inbox row and no delivery for the actor, but does for others", async () => {
    await materializeNotificationFanout(
      tx,
      event("work_item.assigned", "p-actor"),
      {
        resolveRecipients: async () => [
          candidate("p-actor"),
          candidate("p-other"),
        ],
        attachDigest: async () => ({ id: "digest-1" }),
      },
    );
    expect(repo.insertEventInboxRow).toHaveBeenCalledTimes(1);
    expect(repo.insertEventInboxRow.mock.calls[0]?.[1]).toMatchObject({
      personId: "p-other",
    });
    for (const call of repo.insertPendingDelivery.mock.calls)
      expect(call[1].recipientPersonId).toBe("p-other");
  });

  it("does not exclude anyone when the actor is not a person", async () => {
    await materializeNotificationFanout(tx, event("work_item.assigned", null), {
      resolveRecipients: async () => [candidate("p-other")],
      attachDigest: async () => ({ id: "digest-1" }),
    });
    expect(repo.insertEventInboxRow).toHaveBeenCalledTimes(1);
  });
});

describe("NO-7 urgent events bypass digests", () => {
  it.each(["sla.breached", "approval.expiring", "work_item.mentioned"])(
    "%s has no digest_id even when the preference is a digest",
    async (kind) => {
      const attachDigest = vi.fn(async () => ({ id: "digest-1" }));
      await materializeNotificationFanout(tx, event(kind, "p-actor"), {
        resolveRecipients: async () => [candidate("p-other")],
        attachDigest,
      });
      expect(attachDigest).not.toHaveBeenCalled();
      expect(repo.insertPendingDelivery).toHaveBeenCalledTimes(1);
      expect(repo.insertPendingDelivery.mock.calls[0]?.[1].digestId).toBeNull();
    },
  );

  it("a non-urgent event under a digest preference attaches to its group", async () => {
    const attachDigest = vi.fn(async () => ({ id: "digest-1" }));
    await materializeNotificationFanout(
      tx,
      event("work_item.commented", "p-actor"),
      {
        resolveRecipients: async () => [candidate("p-other")],
        attachDigest,
      },
    );
    expect(attachDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientPersonId: "p-other",
        channel: "notify.email",
        cadence: "daily",
      }),
    );
    expect(repo.insertPendingDelivery.mock.calls[0]?.[1].digestId).toBe(
      "digest-1",
    );
  });
});
