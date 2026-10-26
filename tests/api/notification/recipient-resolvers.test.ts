import { describe, expect, it, vi } from "vitest";
import type {
  DbTransaction,
  DomainEventEnvelope,
} from "../../../apps/api/src/events/outbox";
import {
  resolveApiKeyAutoDisabledRecipient,
  resolveWorkspaceCreatedRecipient,
} from "../../../apps/api/src/notification/recipient-resolvers";

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

describe("API-key auto-disable recipient resolution", () => {
  it("fails closed for workspace-scoped or malformed key events before lookup", async () => {
    const tx = {} as DbTransaction;
    const event: DomainEventEnvelope<Record<string, unknown>> = {
      id: "event-2",
      kind: "api_key.auto_disabled",
      occurredAt: "2026-10-25T00:00:00.000Z",
      actor: { type: "system", id: null, name: "TaskDesk" },
      scope: { workspaceId: "not-an-instance-event" },
      payload: {
        key: "key-1",
        apiKeyId: "key-1",
        url: "/agent/settings/profile/api-keys",
        reason: "mcp_burst_threshold_exceeded",
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    };

    await expect(
      resolveApiKeyAutoDisabledRecipient(tx, event),
    ).resolves.toEqual([]);
    await expect(
      resolveApiKeyAutoDisabledRecipient(tx, {
        ...event,
        scope: {},
        payload: { ...event.payload, reason: "unexpected" },
      }),
    ).resolves.toEqual([]);
  });
});
