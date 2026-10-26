import { describe, expect, it } from "vitest";
import type { ClaimedNotificationDelivery } from "../../../apps/api/src/database/repositories/notification-delivery.repository";
import { isLegacyTaskCompatibilityKey } from "../../../apps/api/src/events/event-keys";
import { parseLegacyTaskDeliveryEnvelope } from "../../../apps/api/src/notification/legacy-task-runtime";

const delivery = (
  kind = "comment.created",
  taskId = "task_opaque_42",
): ClaimedNotificationDelivery => ({
  id: "child_1",
  eventId: "evt_parent_1",
  recipientPersonId: "person_staff_1",
  channel: "notify.email",
  workspaceId: "workspace_1",
  organisationId: "org_1",
  dedupeKey: "dedupe_1",
  attempts: 0,
  eventKind: kind,
  payload: {
    id: "evt_parent_1",
    kind,
    occurredAt: "2026-10-25T00:00:00.000Z",
    actor: { type: "person", id: "person_actor_1", name: "TaskDesk actor" },
    scope: { workspaceId: "workspace_1", projectId: "project_1" },
    payload: {
      taskId,
      key: taskId,
      projectId: "project_1",
      url: "/dashboard/workspace/workspace_1/project/project_1/task/task_opaque_42",
      commentId: "comment_1",
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  },
  title: "New task comment",
  body: "A new comment was added to a TaskDesk task.",
  resourceType: "task",
  resourceId: taskId,
});

describe("legacy transactional fanout compatibility boundary", () => {
  it("accepts only retained semantic compatibility keys, excluding cache plumbing", () => {
    for (const kind of [
      "comment.created",
      "comment.updated",
      "time-entry.created",
      "task-relation.created",
    ]) {
      expect(isLegacyTaskCompatibilityKey(kind)).toBe(true);
    }
    expect(isLegacyTaskCompatibilityKey("notification.created")).toBe(false);
    expect(isLegacyTaskCompatibilityKey("task-relation.refresh")).toBe(false);
  });

  it("binds delivery to the same parent id, compatibility kind, scope and actual task id", () => {
    expect(parseLegacyTaskDeliveryEnvelope(delivery())).toMatchObject({
      id: "evt_parent_1",
      kind: "comment.created",
      scope: { workspaceId: "workspace_1", projectId: "project_1" },
      payload: { taskId: "task_opaque_42", key: "task_opaque_42" },
    });
    expect(
      parseLegacyTaskDeliveryEnvelope({
        ...delivery(),
        resourceId: "different_task",
      }),
    ).toBeNull();
    expect(
      parseLegacyTaskDeliveryEnvelope({
        ...delivery(),
        eventKind: "notification.created",
      }),
    ).toBeNull();
    expect(
      parseLegacyTaskDeliveryEnvelope({
        ...delivery(),
        eventId: "evt_other_parent",
      }),
    ).toBeNull();
  });
});
