import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import {
  deleteOwnComment,
  findOwnComment,
  findProjectWorkspaceId,
  lockTaskAndAssertProjectLive,
} from "../repository";

async function deleteComment(
  identity: ResolvedIdentity,
  userId: string,
  id: string,
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
    const deletedComment = await deleteOwnComment(tx, identity, userId, id);
    if (!deletedComment)
      throw new HTTPException(404, {
        message: "Comment not found or you are not the author",
      });

    await appendAuditLog(tx, {
      actorId: userId,
      actorType: identity.credential === "api_key" ? "api_key" : "person",
      workspaceId: project?.workspaceId ?? null,
      projectId: task.projectId,
      action: "comment.deleted",
      entityType: "comment",
      entityId: deletedComment.id,
      before: { content: existing.content ?? null },
      after: null,
    });

    return { deletedComment, projectId: task.projectId };
  });
  await publishEvent("comment.deleted", {
    ...result.deletedComment,
    projectId: result.projectId,
    userId,
  });
  db.transaction(async (tx) => {
    await lockTaskAndAssertProjectLive(tx, identity, existing.taskId);
    await deleteOrphanedAssets(tx, identity, existing.content, null, {
      taskId: existing.taskId,
    });
  }).catch(() => {});
  return result.deletedComment;
}

export default deleteComment;
