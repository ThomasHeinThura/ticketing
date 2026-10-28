import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AUTOMATION_EVENT_TRIGGERS } from "../../../apps/api/src/automation/constants";
import { enqueueAutomationRuns } from "../../../apps/api/src/automation/consumer";
import {
  EVENT_KEYS,
  isLegacyTaskCompatibilityPayload,
  LEGACY_TASK_COMPATIBILITY_KEYS,
} from "../../../apps/api/src/events/event-keys";
import {
  legacyTaskEventActor,
  recordLegacyTaskCompatibilityEvent,
} from "../../../apps/api/src/events/legacy-task-compatibility";
import { parseParentEnvelope } from "../../../apps/api/src/events/outbox-consumer";
import { WEBHOOK_EVENT_KEYS } from "../../../apps/api/src/webhook/constants";
import { enqueueWebhookDeliveries } from "../../../apps/api/src/webhook/consumer";

const EVENTS_MD_PATH = fileURLToPath(
  new URL("../../../docs/technical/events.md", import.meta.url),
);

function compatibilityTaskKeys(): string[] {
  const doc = readFileSync(EVENTS_MD_PATH, "utf8");
  const start = doc.indexOf("## Inherited compatibility vocabulary");
  const end = doc.indexOf("## Not events", start);
  if (start === -1 || end === -1) {
    throw new Error("events.md compatibility section could not be read");
  }
  return [...doc.slice(start, end).matchAll(/^\| `([^`]+)`/gm)].map(
    (match) => match[1] as string,
  );
}

function legacyEnvelope(
  kind: string,
  payload: Record<string, unknown> = {
    taskId: "legacy-task-id",
    key: "legacy-task-id",
    projectId: "project-1",
    url: "/dashboard/workspace/workspace-1/project/project-1/task/legacy-task-id",
  },
) {
  return {
    id: "evt_legacy_1",
    kind,
    occurredAt: new Date(0).toISOString(),
    actor: { type: "person" as const, id: "person-1", name: "TaskDesk actor" },
    scope: { workspaceId: "workspace-1", projectId: "project-1" },
    payload,
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
}

describe("legacy task compatibility bridge", () => {
  it("keeps the published task vocabulary separate from native event registration", () => {
    const documented = compatibilityTaskKeys();
    for (const key of LEGACY_TASK_COMPATIBILITY_KEYS) {
      expect(documented).toContain(key);
    }
    expect(LEGACY_TASK_COMPATIBILITY_KEYS).not.toContain(
      "notification.created",
    );
    expect(LEGACY_TASK_COMPATIBILITY_KEYS).not.toContain(
      "task-relation.refresh",
    );
    for (const key of LEGACY_TASK_COMPATIBILITY_KEYS) {
      expect(EVENT_KEYS.has(key)).toBe(false);
      expect((WEBHOOK_EVENT_KEYS as readonly string[]).includes(key)).toBe(
        false,
      );
      expect(
        (AUTOMATION_EVENT_TRIGGERS as readonly string[]).includes(key),
      ).toBe(false);
    }
  });

  it("writes the actual legacy id, project scope, and legacy task route in the caller transaction", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn(() => ({ values })) } as never;
    await recordLegacyTaskCompatibilityEvent(tx, {
      kind: "task.status_changed",
      taskId: "legacy-task-id",
      projectId: "project-1",
      workspaceId: "workspace-1",
      identity: { credential: "session", personId: "person-1" },
      payload: { oldStatus: "to-do", newStatus: "done" },
      occurredAt: new Date(0),
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task.status_changed",
        workspaceId: "workspace-1",
        payload: expect.objectContaining({
          actor: { type: "person", id: "person-1", name: "TaskDesk actor" },
          kind: "task.status_changed",
          scope: { workspaceId: "workspace-1", projectId: "project-1" },
          payload: expect.objectContaining({
            taskId: "legacy-task-id",
            key: "legacy-task-id",
            projectId: "project-1",
            url: "/dashboard/workspace/workspace-1/project/project-1/task/legacy-task-id",
            oldStatus: "to-do",
            newStatus: "done",
          }),
        }),
      }),
    );
  });

  it("attributes API-key events to their authenticated key id and fails closed without it", () => {
    expect(
      legacyTaskEventActor(
        { credential: "api_key", personId: "person-owner" },
        "key-actual",
      ),
    ).toEqual({ type: "api_key", id: "key-actual", name: "API key actor" });
    expect(() =>
      legacyTaskEventActor({ credential: "api_key", personId: "person-owner" }),
    ).toThrow("authenticated key id");
  });

  it("rejects task identity or scope mismatches when validating a stored event", () => {
    const payload = {
      taskId: "task-1",
      key: "task-1",
      projectId: "project-1",
      url: "/dashboard/workspace/ws-1/project/project-1/task/task-1",
    };
    const scope = { workspaceId: "ws-1", projectId: "project-1" };
    expect(isLegacyTaskCompatibilityPayload(payload, scope)).toBe(true);
    expect(
      isLegacyTaskCompatibilityPayload(
        { ...payload, key: "fake-work-item-key" },
        scope,
      ),
    ).toBe(false);
    expect(
      isLegacyTaskCompatibilityPayload(payload, {
        ...scope,
        projectId: "other",
      }),
    ).toBe(false);
  });

  it("accepts valid compatibility parents but rejects unknown event kinds", () => {
    const event = legacyEnvelope("task.status_changed");
    expect(
      parseParentEnvelope({
        eventId: event.id,
        kind: event.kind,
        payload: event,
      }),
    ).toEqual(event);
    expect(() =>
      parseParentEnvelope({
        eventId: event.id,
        kind: "task.not_registered",
        payload: { ...event, kind: "task.not_registered" },
      }),
    ).toThrow("does not match");
  });

  it("does not let corrupted native configuration subscribe to compatibility events", async () => {
    const select = vi.fn();
    const tx = { select } as never;
    const event = legacyEnvelope("task.created");
    await expect(enqueueWebhookDeliveries(tx, event)).resolves.toBe(0);
    await expect(enqueueAutomationRuns(tx, event)).resolves.toBe(0);
    expect(select).not.toHaveBeenCalled();
  });
});
