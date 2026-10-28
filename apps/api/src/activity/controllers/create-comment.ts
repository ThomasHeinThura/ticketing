import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import {
  dispatchLegacyTaskNotification,
  insertLegacyTaskNotification,
} from "../../events/legacy-task-effects";
import { parseMentionIds } from "../../utils/parse-mentions";
import {
  findProjectWorkspaceId,
  findUserName,
  insertCommentActivity,
  lockTaskAndAssertProjectLive,
} from "../repository";

async function createComment(
  identity: ResolvedIdentity,
  taskId: string,
  userId: string,
  content: string,
  external?: { userName: string; source: string },
  apiKeyId?: string | null,
) {
  const mentionedIds = [...new Set(parseMentionIds(content))].filter(
    (id) => id !== userId,
  );
  const { activity, task, notifications } = await db.transaction(async (tx) => {
    const lockedTask = await lockTaskAndAssertProjectLive(tx, identity, taskId);
    const activity = await insertCommentActivity(tx, identity, {
      taskId,
      userId,
      content,
      external,
    });
    const project = await findProjectWorkspaceId(
      tx,
      identity,
      lockedTask.projectId,
    );
    if (!project) throw new HTTPException(404, { message: "Task not found" });
    const user = await findUserName(userId);
    const eventId = await recordLegacyTaskCompatibilityEvent(tx, {
      kind: "comment.created",
      taskId,
      projectId: lockedTask.projectId,
      workspaceId: project.workspaceId,
      identity,
      apiKeyId,
      payload: { commentId: activity.id, userId, type: "comment.created" },
    });

    await appendAuditLog(tx, {
      actorId: userId,
      actorType: identity.credential === "api_key" ? "api_key" : "person",
      workspaceId: project.workspaceId,
      projectId: lockedTask.projectId,
      action: "work_item.commented",
      entityType: "comment",
      entityId: activity.id,
      before: null,
      after: {
        taskId,
        content: activity.content ?? null,
      },
    });

    const notifications = [];
    for (const recipientUserId of mentionedIds) {
      const notification = await insertLegacyTaskNotification(tx, {
        eventId,
        eventKind: "comment.created",
        userId: recipientUserId,
        type: "task_mention",
        taskId,
        projectId: lockedTask.projectId,
        eventData: {
          taskTitle: lockedTask.title,
          mentionerName: user?.name ?? null,
          projectId: lockedTask.projectId,
          workspaceId: project.workspaceId,
        },
      });
      if (notification) notifications.push(notification);
    }
    if (
      lockedTask.userId &&
      lockedTask.userId !== userId &&
      !mentionedIds.includes(lockedTask.userId)
    ) {
      const notification = await insertLegacyTaskNotification(tx, {
        eventId,
        eventKind: "comment.created",
        userId: lockedTask.userId,
        type: "task_comment",
        taskId,
        projectId: lockedTask.projectId,
        eventData: {
          taskTitle: lockedTask.title,
          commenterName: user?.name ?? null,
          commentPreview: content.slice(0, 160),
          projectId: lockedTask.projectId,
          workspaceId: project.workspaceId,
        },
      });
      if (notification) notifications.push(notification);
    }

    return {
      activity,
      notifications,
      task: {
        projectId: lockedTask.projectId,
      },
    };
  });

  const user = await findUserName(userId);
  await publishEvent("comment.created", {
    ...activity,
    comment: `**${user?.name}** commented:\n> ${content}`,
    projectId: task.projectId,
  });
  for (const notification of notifications) {
    await dispatchLegacyTaskNotification(notification);
  }
  return activity;
}

export default createComment;
