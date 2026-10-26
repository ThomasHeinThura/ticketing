import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import createNotification from "../../notification/controllers/create-notification";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { parseMentionIds } from "../../utils/parse-mentions";
import { lockTaskAndAssertProjectLiveForIdentity } from "../assert-task-project-live";
import { findUserName, updateTaskRow } from "../repository";

async function updateTaskDescription({
  identity,
  id,
  description,
  currentUserId,
  apiKeyId,
}: {
  identity: ResolvedIdentity;
  id: string;
  description: string;
  currentUserId: string;
  apiKeyId?: string | null;
}) {
  const { existingTask, updatedTask, changed } = await db.transaction(
    async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      if (existingTask.description === description) {
        return { existingTask, updatedTask: existingTask, changed: false };
      }
      const updatedTask = await updateTaskRow(tx, identity, id, {
        description,
      });
      if (updatedTask) {
        const workspaceId = await getProjectWorkspaceId(
          updatedTask.projectId,
          tx,
        );
        await recordLegacyTaskCompatibilityEvent(tx, {
          kind: "task.description_changed",
          taskId: updatedTask.id,
          projectId: updatedTask.projectId,
          workspaceId,
          identity,
          apiKeyId,
          payload: {
            oldDescription: existingTask.description,
            newDescription: updatedTask.description,
            type: "description_changed",
          },
        });
      }
      return { existingTask, updatedTask, changed: true };
    },
  );

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task description",
    });
  }

  if (!changed) return updatedTask;

  await publishEvent("task.description_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldDescription: existingTask.description,
    newDescription: description,
    type: "description_changed",
  });

  db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLiveForIdentity(tx, id, identity);
    await deleteOrphanedAssets(
      tx,
      identity,
      existingTask.description,
      description,
      {
        taskId: id,
      },
    );
  }).catch(() => {});

  // Notify members newly @mentioned by this edit (skip ones already mentioned
  // in the previous description, and the editor themselves).
  const alreadyMentioned = new Set(parseMentionIds(existingTask.description));
  const newlyMentioned = parseMentionIds(description).filter(
    (mentionedId) =>
      mentionedId !== currentUserId && !alreadyMentioned.has(mentionedId),
  );

  if (newlyMentioned.length > 0) {
    const editor = await findUserName(
      identity,
      currentUserId,
      existingTask.projectId,
    );

    for (const mentionedId of newlyMentioned) {
      await createNotification({
        userId: mentionedId,
        type: "task_mention",
        eventData: {
          taskTitle: updatedTask.title,
          mentionerName: editor?.name ?? null,
        },
        resourceId: updatedTask.id,
        resourceType: "task",
      });
    }
  }

  return updatedTask;
}

export default updateTaskDescription;
