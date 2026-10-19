import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import createNotification from "../../notification/controllers/create-notification";
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
) {
  const { activity, task } = await db.transaction(async (tx) => {
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
    return {
      activity,
      task: {
        assigneeId: lockedTask.userId,
        projectId: lockedTask.projectId,
        title: lockedTask.title,
        workspaceId: project.workspaceId,
      },
    };
  });

  const user = await findUserName(userId);
  await publishEvent("comment.created", {
    ...activity,
    comment: `**${user?.name}** commented:\n> ${content}`,
    projectId: task.projectId,
  });
  const mentionedIds = parseMentionIds(content).filter((id) => id !== userId);
  for (const mentionedId of mentionedIds) {
    await createNotification({
      userId: mentionedId,
      type: "task_mention",
      eventData: {
        taskTitle: task.title,
        mentionerName: user?.name ?? null,
        projectId: task.projectId,
        workspaceId: task.workspaceId,
      },
      resourceId: taskId,
      resourceType: "task",
    });
  }
  if (
    task.assigneeId &&
    task.assigneeId !== userId &&
    !mentionedIds.includes(task.assigneeId)
  ) {
    await createNotification({
      userId: task.assigneeId,
      type: "task_comment",
      eventData: {
        taskTitle: task.title,
        commenterName: user?.name ?? null,
        commentPreview: content.slice(0, 160),
        projectId: task.projectId,
        workspaceId: task.workspaceId,
      },
      resourceId: taskId,
      resourceType: "task",
    });
  }
  return activity;
}

export default createComment;
