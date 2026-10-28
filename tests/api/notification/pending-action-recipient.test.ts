import { describe, expect, it, vi } from "vitest";
import type {
  DbTransaction,
  DomainEventEnvelope,
} from "../../../apps/api/src/events/outbox";
import type { PendingActionNotificationContext } from "../../../apps/api/src/notification/pending-action-recipient.repository";

// Recipient resolution is exercised with injected repository/identity dependencies.
vi.mock("../../../apps/api/src/database", () => ({ default: {}, schema: {} }));

const { resolvePendingActionEventRecipients } = await import(
  "../../../apps/api/src/notification/recipient-resolvers"
);

const tx = {} as DbTransaction;

function context(
  overrides: Partial<PendingActionNotificationContext> = {},
): PendingActionNotificationContext {
  return {
    id: "pa-1",
    requestedByPersonId: "person-1",
    origin: "api",
    credentialType: "api_key",
    credentialId: "key-1",
    action: "delete",
    targetType: "work_item",
    targetIds: ["SUP-1234"],
    payloadSummary: { key: "SUP-1234", title: "Never shown" },
    state: "pending",
    workspaceId: "workspace-1",
    requesterUserId: "user-1",
    requesterActive: true,
    requesterSide: "staff",
    keyName: "ci-bot",
    keyOwnerUserId: "user-1",
    ...overrides,
  };
}

function event(
  kind: "pending_action.requested" | "pending_action.executed",
  payload: Record<string, unknown>,
  scope: DomainEventEnvelope<Record<string, unknown>>["scope"] = {
    workspaceId: "workspace-1",
  },
): DomainEventEnvelope<Record<string, unknown>> {
  return {
    id: "evt-1",
    kind,
    occurredAt: "2026-10-22T00:00:00.000Z",
    actor: { type: "api_key", id: "key-1", name: "ci-bot" },
    scope,
    payload: { pendingActionId: "pa-1", ...payload },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
}

function deps(row: PendingActionNotificationContext | undefined) {
  return {
    findContext: vi.fn(async () => row),
    resolveRequesterIdentity: vi.fn(async () => ({ personId: "person-1" })),
  };
}

describe("pending_action notification recipients (NO-21)", () => {
  it.each(["api", "mcp"] as const)(
    "notifies the requester of a %s-origin request with the key and target named",
    async (origin) => {
      const d = deps(context({ origin }));
      await expect(
        resolvePendingActionEventRecipients(
          tx,
          event("pending_action.requested", { origin }),
          d,
        ),
      ).resolves.toEqual([
        {
          personId: "person-1",
          resourceType: "pending_action",
          resourceId: "pa-1",
          title: "Deletion awaiting your approval",
          body: "An agent using your key ci-bot asked to delete SUP-1234.",
          channels: [],
        },
      ]);
    },
  );

  it("sends nothing for a web-origin request and reads nothing", async () => {
    const d = deps(context({ origin: "web", credentialType: "session" }));
    await expect(
      resolvePendingActionEventRecipients(
        tx,
        event("pending_action.requested", { origin: "web" }),
        d,
      ),
    ).resolves.toEqual([]);
    expect(d.findContext).not.toHaveBeenCalled();
  });

  it.each([
    ["the row is missing", undefined],
    ["the stored origin is web", context({ origin: "web" })],
    ["the key belongs to someone else", context({ keyOwnerUserId: "user-2" })],
    ["the key row is gone", context({ keyOwnerUserId: null, keyName: null })],
    ["the requester is inactive", context({ requesterActive: false })],
    ["the requester has no login", context({ requesterUserId: null })],
    ["the requester is a customer", context({ requesterSide: "customer" })],
    [
      "the row is in another workspace",
      context({ workspaceId: "workspace-2" }),
    ],
  ])("fails closed when %s", async (_label, row) => {
    await expect(
      resolvePendingActionEventRecipients(
        tx,
        event("pending_action.requested", { origin: "api" }),
        deps(row),
      ),
    ).resolves.toEqual([]);
  });

  it("never substitutes another identity for the requester", async () => {
    const d = deps(context());
    d.resolveRequesterIdentity.mockResolvedValueOnce({ personId: "person-9" });
    await expect(
      resolvePendingActionEventRecipients(
        tx,
        event("pending_action.requested", { origin: "api" }),
        d,
      ),
    ).resolves.toEqual([]);
  });

  it("uses a generic phrase when the key has no name and never shows summary text", async () => {
    const [candidate] = await resolvePendingActionEventRecipients(
      tx,
      event("pending_action.requested", { origin: "api" }),
      deps(
        context({
          keyName: null,
          targetType: "comment",
          targetIds: ["comment-1"],
          payloadSummary: { commentBody: "private words" },
        }),
      ),
    );
    expect(candidate?.body).toBe(
      "An agent using one of your API keys asked to delete a comment.",
    );
  });

  it("notifies the requester only when execution failed", async () => {
    await expect(
      resolvePendingActionEventRecipients(
        tx,
        event("pending_action.executed", { outcome: "executed" }),
        deps(context({ state: "executed" })),
      ),
    ).resolves.toEqual([]);
    await expect(
      resolvePendingActionEventRecipients(
        tx,
        event("pending_action.executed", { outcome: "failed" }),
        deps(context({ state: "pending" })),
      ),
    ).resolves.toEqual([]);
    await expect(
      resolvePendingActionEventRecipients(
        tx,
        event("pending_action.executed", { outcome: "failed" }),
        deps(context({ state: "failed", origin: "web", keyName: null })),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        personId: "person-1",
        resourceType: "pending_action",
        resourceId: "pa-1",
        title: "Approved deletion failed",
      }),
    ]);
  });

  it("matches an instance-scoped row only to an instance-scoped event", async () => {
    const row = context({ workspaceId: null, state: "failed" });
    await expect(
      resolvePendingActionEventRecipients(
        tx,
        event("pending_action.executed", { outcome: "failed" }, {}),
        deps(row),
      ),
    ).resolves.toHaveLength(1);
  });
});
