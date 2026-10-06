import { describe, expect, it, vi } from "vitest";
import type {
  DbTransaction,
  DomainEventEnvelope,
} from "../../../apps/api/src/events/outbox";
import { resolveWorkspaceCreatedRecipient } from "../../../apps/api/src/notification/recipient-resolvers";

describe("workspace-created recipient resolution", () => {
  it("fails closed when the event scope does not match its workspace resource", async () => {
    const tx = {} as DbTransaction;
    const enabledChannels = vi.fn(async () => []);
    const event: DomainEventEnvelope<Record<string, unknown>> = {
      id: "event-1",
      kind: "workspace.created",
      occurredAt: "2026-10-06T00:00:00.000Z",
      actor: { type: "system", id: null, name: "system" },
      scope: { workspaceId: "scope-workspace" },
      payload: { workspaceId: "payload-workspace", ownerId: "owner-user" },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    };

    await expect(
      resolveWorkspaceCreatedRecipient(tx, event, enabledChannels),
    ).resolves.toEqual([]);
    expect(enabledChannels).not.toHaveBeenCalled();
  });
});
