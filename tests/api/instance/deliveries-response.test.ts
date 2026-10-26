import { describe, expect, it } from "vitest";
import {
  projectDeliveryCounts,
  projectDeliveryItems,
} from "../../../apps/api/src/instance/deliveries/response";

describe("instance delivery response projection", () => {
  it("keeps operational metadata while dropping payload, recipient, and provider detail", () => {
    const [item] = projectDeliveryItems([
      {
        id: "delivery-1",
        kind: "webhook",
        state: "dead",
        createdAt: new Date("2026-10-25T00:00:00.000Z"),
        eventId: "event-1",
        eventKind: "work_item.updated",
        source: "event",
        attempts: 6,
        statusCode: 500,
        durationMs: 42,
        hasError: true,
        // These fields model database material that must never cross this boundary.
        recipientPersonId: "person-private",
        requestBody: { description: "private work item text" },
        responseBody: "provider returned private data",
        error: "https://private.example.test/path?token=secret",
      } as never,
    ]);

    expect(item).toEqual({
      id: "delivery-1",
      kind: "webhook",
      state: "dead",
      createdAt: "2026-10-25T00:00:00.000Z",
      requeueAllowed: false,
      eventId: "event-1",
      eventKind: "work_item.updated",
      attempts: 6,
      source: "event",
      statusCode: 500,
      durationMs: 42,
      errorPresent: true,
    });
    expect(JSON.stringify(item)).not.toContain("person-private");
    expect(JSON.stringify(item)).not.toContain("private work item text");
    expect(JSON.stringify(item)).not.toContain("secret");
  });

  it("normalizes database counts and rejects non-finite or negative values", () => {
    expect(
      projectDeliveryCounts({
        eventsPending: "2",
        eventsDead: -1,
        notificationsPending: Number.NaN,
        notificationsDelivered: 3,
        digestsCollecting: 1,
        webhooksDead: "4",
      }),
    ).toEqual({
      events: { pending: 2, dead: 0 },
      notifications: { pending: 0, delivered: 3, suppressed: 0, dead: 0 },
      digests: {
        collecting: 1,
        pending: 0,
        delivered: 0,
        suppressed: 0,
        dead: 0,
      },
      webhooks: {
        pending: 0,
        delivered: 0,
        dead: 4,
        skippedOutOfReach: 0,
        cancelled: 0,
      },
    });
  });

  it("drops rows with invalid creation timestamps rather than rendering corrupt data", () => {
    expect(
      projectDeliveryItems([
        { id: "bad", kind: "event", state: "pending", createdAt: "invalid" },
      ]),
    ).toEqual([]);
  });

  it("projects only the server-derived requeue affordance and defaults every other row closed", () => {
    const items = projectDeliveryItems([
      {
        id: "event-dead",
        kind: "event",
        state: "dead",
        createdAt: "2026-10-25T00:00:00.000Z",
        requeueAllowed: true,
      },
      {
        id: "notification-dead",
        kind: "notification",
        state: "dead",
        createdAt: "2026-10-25T00:00:00.000Z",
        requeueAllowed: true,
        recipientPersonId: "private-person",
        dedupeKey: "private-dedupe",
      } as never,
      {
        id: "digest-dead",
        kind: "digest",
        state: "dead",
        createdAt: "2026-10-25T00:00:00.000Z",
      },
      {
        id: "webhook-dead",
        kind: "webhook",
        state: "dead",
        createdAt: "2026-10-25T00:00:00.000Z",
      },
    ]);

    expect(
      items.map(({ kind, requeueAllowed }) => [kind, requeueAllowed]),
    ).toEqual([
      ["event", true],
      ["notification", true],
      ["digest", false],
      ["webhook", false],
    ]);
    expect(JSON.stringify(items)).not.toContain("private-person");
    expect(JSON.stringify(items)).not.toContain("private-dedupe");
  });
});
