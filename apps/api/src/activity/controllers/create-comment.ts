import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskActivityTable } from "../../database/schema";
import { publishEvent } from "../../events";
import createNotification from "../../notification/controllers/create-notification";
import { lockTaskAndAssertProjectLive } from "../../task/assert-task-project-live";
import { parseMentionIds } from "../../utils/parse-mentions";
import { getProjectWorkspace, getUserName } from "../repository";

async function createComment(
  taskId: string,
  userId: string,
  content: string,
  external?: { userName: string; source: string },
) {
  const { activity, taskContext } = await db.transaction(async (tx) => {
    const lockedTask = await lockTaskAndAssertProjectLive(tx, taskId);
    const [activity] = await tx
      .insert(taskActivityTable)
      .values({
        taskId,
        type: "comment",
        userId,
        content,
        ...(external
          ? {
              externalUserName: external.userName,
              externalSource: external.source,
            }
          : {}),
      })
      .returning();
    const project = await getProjectWorkspace(tx, lockedTask.projectId);
    if (!project) throw new HTTPException(404, { message: "Task not found" });
    return {
      activity,
      taskContext: {
        assigneeId: lockedTask.userId,
        projectId: lockedTask.projectId,
        title: lockedTask.title,
        workspaceId: project.workspaceId,
      },
    };
  });

  if (!activity) {
    throw new HTTPException(500, {
      message: "Failed to create activity",
    });
  }

  const [user] = await getUserName(db, userId);

  const task = taskContext;

  if (task) {
    await publishEvent("comment.created", {
      ...activity,
      comment: `**${user?.name}** commented:\n> ${content}`,
      projectId: task.projectId,
    });
  }

  // Notify any workspace members @mentioned in the comment (not the author).
  const mentionedIds = parseMentionIds(content).filter((id) => id !== userId);
  for (const mentionedId of mentionedIds) {
    await createNotification({
      userId: mentionedId,
      type: "task_mention",
      eventData: {
        taskTitle: task?.title ?? null,
        mentionerName: user?.name ?? null,
        projectId: task?.projectId ?? null,
        workspaceId: task?.workspaceId ?? null,
      },
      resourceId: taskId,
      resourceType: "task",
    });
  }

  if (
    task?.assigneeId &&
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
