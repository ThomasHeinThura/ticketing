import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import {
  dispatchLegacyTaskNotification,
  insertLegacyTaskNotification,
} from "../../events/legacy-task-effects";
import { syncInlineAssetReferences } from "../../storage/cleanup-assets";
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
  const { existingTask, updatedTask, changed, notifications } =
    await db.transaction(async (tx) => {
      const existingTask = await lockTaskAndAssertProjectLiveForIdentity(
        tx,
        id,
        identity,
      );
      if (existingTask.description === description) {
        return {
          existingTask,
          updatedTask: existingTask,
          changed: false,
          notifications: [],
        };
      }
      const updatedTask = await updateTaskRow(tx, identity, id, {
        description,
      });
      const notifications: Awaited<
        ReturnType<typeof insertLegacyTaskNotification>
      >[] = [];
      if (updatedTask) {
        const workspaceId = await getProjectWorkspaceId(
          updatedTask.projectId,
          tx,
        );
        const eventId = await recordLegacyTaskCompatibilityEvent(tx, {
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
        // P0R1-01: detach (never delete) removed inline images in this transaction.
        await syncInlineAssetReferences(
          tx,
          identity,
          existingTask.description,
          description,
          { taskId: id },
        );
        // P0R1-03: newly @mentioned members are notified through the same event-linked,
        // transactional path as comment mentions. The writer re-checks staff side and
        // project reach per recipient and is idempotent on (event, person).
        const alreadyMentioned = new Set(
          parseMentionIds(existingTask.description),
        );
        const newlyMentioned = [
          ...new Set(
            parseMentionIds(description).filter(
              (mentionedId) =>
                mentionedId !== currentUserId &&
                !alreadyMentioned.has(mentionedId),
            ),
          ),
        ];
        if (newlyMentioned.length > 0) {
          const editor = await findUserName(
            identity,
            currentUserId,
            existingTask.projectId,
          );
          for (const mentionedId of newlyMentioned) {
            notifications.push(
              await insertLegacyTaskNotification(tx, {
                eventId,
                eventKind: "task.description_changed",
                userId: mentionedId,
                type: "task_mention",
                taskId: updatedTask.id,
                projectId: updatedTask.projectId,
                eventData: {
                  taskTitle: updatedTask.title,
                  mentionerName: editor?.name ?? null,
                  projectId: updatedTask.projectId,
                  workspaceId,
                },
              }),
            );
          }
        }
      }
      return { existingTask, updatedTask, changed: true, notifications };
    });

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

  for (const notification of notifications) {
    await dispatchLegacyTaskNotification(notification);
  }

  return updatedTask;
}

export default updateTaskDescription;
