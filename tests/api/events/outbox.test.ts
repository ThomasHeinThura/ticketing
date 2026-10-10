import { describe, expect, it, vi } from "vitest";
import {
  enqueueOutboxEvent,
  eventScope,
} from "../../../apps/api/src/events/outbox";

describe("instance-scoped event envelopes", () => {
  it("keeps a zero-workspace person event instance-scoped", () => {
    expect(
      eventScope({ workspaceId: null, organisationId: null, projectId: null }),
    ).toEqual({});
  });

  it("does not widen a missing workspace to organisation or project scope", () => {
    expect(() =>
      eventScope({
        workspaceId: null,
        organisationId: "org-1",
        projectId: null,
      }),
    ).toThrow("An instance event cannot include narrower scope");
  });

  it("persists a registered lifecycle event without a workspace", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn(() => ({ values })) } as never;

    await enqueueOutboxEvent(tx, {
      id: "evt_instance_scope",
      kind: "identity.deprovisioned",
      occurredAt: new Date(0).toISOString(),
      actor: { type: "system", id: null, name: "System" },
      scope: {},
      payload: { personId: "person-1" },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: null }),
    );
  });

  it("rejects unrelated event keys before writing an instance-scoped row", async () => {
    const insert = vi.fn();
    const tx = { insert } as never;

    await expect(
      enqueueOutboxEvent(tx, {
        id: "evt_invalid_instance_scope",
        kind: "work_item.created",
        occurredAt: new Date(0).toISOString(),
        actor: { type: "system", id: null, name: "System" },
        scope: {},
        payload: { key: "WLP-1", url: "/agent/projects/WLP/work/WLP-1" },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      }),
    ).rejects.toThrow("Event kind does not permit instance scope");
    expect(insert).not.toHaveBeenCalled();
  });
});
