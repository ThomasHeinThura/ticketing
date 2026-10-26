import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { publishEvent } from "../../events";
import { recordLegacyTaskCompatibilityEvent } from "../../events/legacy-task-compatibility";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import {
  findOwnComment,
  findProjectWorkspaceId,
  lockTaskAndAssertProjectLive,
  updateOwnCommentContent,
} from "../repository";

async function updateComment(
  identity: ResolvedIdentity,
  userId: string,
  id: string,
  content: string,
  apiKeyId?: string | null,
) {
  const existing = await findOwnComment(identity, userId, id);
  if (!existing)
    throw new HTTPException(404, {
      message: "Comment not found or you are not the author",
    });
  const result = await db.transaction(async (tx) => {
    const task = await lockTaskAndAssertProjectLive(
      tx,
      identity,
      existing.taskId,
    );
    const project = await findProjectWorkspaceId(tx, identity, task.projectId);
    const updated = await updateOwnCommentContent(
      tx,
      identity,
      userId,
      id,
      content,
    );
    if (!updated)
      throw new HTTPException(404, {
        message: "Comment not found or you are not the author",
      });

    if (!project) throw new HTTPException(404, { message: "Task not found" });
    await recordLegacyTaskCompatibilityEvent(tx, {
      kind: "comment.updated",
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: project.workspaceId,
      identity,
      apiKeyId,
      payload: { commentId: updated.id, userId, type: "comment.updated" },
    });

    await appendAuditLog(tx, {
      actorId: userId,
      actorType: identity.credential === "api_key" ? "api_key" : "person",
      workspaceId: project.workspaceId,
      projectId: task.projectId,
      action: "comment.updated",
      entityType: "comment",
      entityId: updated.id,
      before: { content: existing.content ?? null },
      after: { content: updated.content ?? null },
    });

    return { updated, projectId: task.projectId };
  });
  await publishEvent("comment.updated", {
    ...result.updated,
    projectId: result.projectId,
    userId,
  });
  db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLive(tx, identity, existing.taskId);
    await deleteOrphanedAssets(tx, identity, existing.content, content, {
      taskId: existing.taskId,
    });
  }).catch(() => {});
  return result.updated;
}

export default updateComment;
