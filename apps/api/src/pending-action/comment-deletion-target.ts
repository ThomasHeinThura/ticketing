import { createHash } from "node:crypto";
import { can, type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { schema } from "../database";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  commentAccess,
  loadCommentCaller,
  resolveCommentAuthors,
} from "../work-item/comment-access";
import { deleteCommentInTransaction } from "../work-item/controllers/delete-comment";
import {
  approveClickDeletion,
  type ClickDeletionApprovalInput,
} from "./click-deletion-executor";
import { failOnExecutorError } from "./execution-failure";
import {
  type ActionRequiredAccessInput,
  evaluateActionRequiredAccess,
  type RequiredAccessDecision,
} from "./required-access";
import type {
  CreatePendingActionInput,
  PendingActionTransaction,
} from "./service";

export const COMMENT_DELETION_ROUTE = "DELETE /api/comments/{id}" as const;

/** Lifecycle gate precedes parent, project, then comment. The live parent fences moves/deletion. */
export async function loadCommentDeletionTarget(
  tx: PendingActionTransaction,
  id: string,
) {
  const [anchor] = await tx
    .select()
    .from(schema.commentTable)
    .where(eq(schema.commentTable.id, id))
    .limit(1);
  if (!anchor) return undefined;
  const [item] = await tx
    .select()
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.id, anchor.workItemId),
        eq(schema.workItemTable.workspaceId, anchor.workspaceId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!item) return undefined;
  const [project] = await tx
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, item.projectId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!project) return undefined;
  const [comment] = await tx
    .select()
    .from(schema.commentTable)
    .where(
      and(
        eq(schema.commentTable.id, id),
        eq(schema.commentTable.workItemId, item.id),
        eq(schema.commentTable.workspaceId, item.workspaceId),
      ),
    )
    .for("update")
    .limit(1);
  if (!comment) return undefined;
  const [revision] = await tx
    .select({ value: count() })
    .from(schema.commentVersionTable)
    .where(eq(schema.commentVersionTable.commentId, id));
  const [precise] = await tx
    .select({
      row: sql<string>`to_jsonb(${schema.commentTable})::text`,
      editedAt: sql<string | null>`${schema.commentTable.editedAt}::text`,
      deletedAt: sql<string | null>`${schema.commentTable.deletedAt}::text`,
    })
    .from(schema.commentTable)
    .where(eq(schema.commentTable.id, id));
  if (!precise) return undefined;
  return { comment, item, project, revision: revision?.value ?? 0, precise };
}
type Target = NonNullable<
  Awaited<ReturnType<typeof loadCommentDeletionTarget>>
>;
function snapshot(target: Target) {
  return {
    commentId: target.comment.id,
    workItemId: target.item.id,
    key: target.item.key,
    workspaceId: target.item.workspaceId,
    projectId: target.item.projectId,
    parentVersion: target.item.version,
    authorId: target.comment.authorId,
    visibility: target.comment.visibility,
    bodyHash: createHash("sha256")
      .update(JSON.stringify(target.comment.body))
      .digest("hex"),
    rowHash: createHash("sha256").update(target.precise.row).digest("hex"),
    revision: target.revision,
    editedAt: target.precise?.editedAt ?? null,
    deletedAt: target.precise?.deletedAt ?? null,
  };
}
function readable(
  identity: ResolvedIdentity,
  target: Pick<Target, "item" | "project">,
) {
  return (
    reaches(identity, {
      workspaceId: target.item.workspaceId,
      projectId: target.item.projectId,
      organisationId: target.project.organisationId,
    }) &&
    can(identity, "work_item:read", "work_item", {
      workspaceId: target.item.workspaceId,
      workItemProjectId: target.item.projectId,
      workItemId: target.item.id,
    })
  );
}
export async function evaluateCommentDeletionAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
): Promise<RequiredAccessDecision> {
  if (
    input.action !== "delete" ||
    input.targetType !== "comment" ||
    input.routeKey !== COMMENT_DELETION_ROUTE ||
    input.targetIds.length !== 1 ||
    input.confirmationRequired !== "click"
  )
    return { allowed: false, failure: "unsupported", status: 403 };
  const target = await loadCommentDeletionTarget(tx, input.targetIds[0] ?? "");
  if (
    !target ||
    target.item.workspaceId !== input.workspaceId ||
    target.item.projectId !== input.projectId ||
    target.project.organisationId !== input.organisationId
  )
    return { allowed: false, failure: "target_scope", status: 404 };
  if (!readable(identity, target))
    return { allowed: false, failure: "reach", status: 404 };
  const [person] = await tx
    .select({ userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, identity.personId));
  if (!person?.userId)
    return { allowed: false, failure: "capability", status: 403 };
  // Natural expiry does not invalidate a durable request, but a removed origin session does.
  if (input.credentialType === "session") {
    const [session] = await tx
      .select({
        id: schema.sessionTable.id,
        impersonatedBy: schema.sessionTable.impersonatedBy,
      })
      .from(schema.sessionTable)
      .where(
        and(
          eq(schema.sessionTable.id, input.credentialId ?? ""),
          eq(schema.sessionTable.userId, person.userId),
          eq(schema.sessionTable.portal, "agent"),
        ),
      )
      .limit(1);
    if (!session || session.impersonatedBy)
      return { allowed: false, failure: "credential", status: 403 };
  }
  // Identity was freshly resolved by the common PA credential evaluator, including the original key ceiling.
  const caller = await loadCommentCaller(
    tx,
    { userId: person.userId },
    {
      workspaceId: target.item.workspaceId,
      projectId: target.item.projectId,
      workItemId: target.item.id,
    },
    identity,
  );
  const authors = await resolveCommentAuthors(tx, [target.comment.authorId]);
  if (
    !commentAccess(
      caller,
      target.comment.authorId
        ? (authors.get(target.comment.authorId) ?? null)
        : null,
      target.comment,
    ).mayDelete
  )
    return { allowed: false, failure: "capability", status: 403 };
  if (input.payload !== undefined || input.targetVersions != null) {
    const versions = input.targetVersions as Record<string, unknown> | null;
    if (
      !versions ||
      JSON.stringify(versions[target.comment.id]) !==
        JSON.stringify(snapshot(target))
    ) {
      // JSONB does not retain object key order.
      const stored = versions?.[target.comment.id];
      const expected = snapshot(target);
      if (
        !stored ||
        typeof stored !== "object" ||
        Array.isArray(stored) ||
        Object.keys(stored).length !== Object.keys(expected).length ||
        Object.entries(expected).some(
          ([key, value]) => (stored as Record<string, unknown>)[key] !== value,
        )
      )
        return { allowed: false, failure: "target_version", status: 409 };
    }
  }
  return { allowed: true };
}
export async function resolveCommentDeletionRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
) {
  if (
    !(
      (input.origin === "web" && input.credentialType === "session") ||
      ((input.origin === "api" || input.origin === "mcp") &&
        input.credentialType === "api_key")
    )
  )
    throw new HTTPException(403, {
      message: "pending_action_credential_unsupported",
    });
  const target = await loadCommentDeletionTarget(tx, input.targetIds[0] ?? "");
  if (!target) throw new HTTPException(404, { message: "Comment not found" });
  const scope = {
    workspaceId: target.item.workspaceId,
    projectId: target.item.projectId,
    organisationId: target.project.organisationId,
  };
  if (
    (input.workspaceId !== undefined &&
      input.workspaceId !== scope.workspaceId) ||
    (input.projectId !== undefined && input.projectId !== scope.projectId) ||
    (input.organisationId !== undefined &&
      input.organisationId !== scope.organisationId)
  )
    throw new HTTPException(404, { message: "Comment not found" });
  const access = await evaluateActionRequiredAccess(tx, {
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    action: input.action,
    targetType: input.targetType,
    targetIds: input.targetIds,
    routeKey: input.routeKey,
    ...scope,
    confirmationRequired: "click",
  });
  if (!access.allowed)
    throw new HTTPException(access.status === 404 ? 404 : 403, {
      message: access.status === 404 ? "Comment not found" : "Forbidden",
    });
  const [actor] = await tx
    .select({ userId: schema.personTable.userId, name: schema.userTable.name })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(eq(schema.personTable.id, input.requesterPersonId));
  if (!actor || actor.userId !== input.actorId)
    throw new HTTPException(403, { message: "Forbidden" });
  return {
    ...scope,
    actorName: actor.name,
    summary: {
      commentId: target.comment.id,
      key: target.item.key,
      title: target.item.title,
      visibility: target.comment.visibility,
      commentBody: target.comment.body,
      alreadyDeleted: target.comment.deletedAt !== null,
      requesterName: actor.name,
    },
    targetVersions: { [target.comment.id]: snapshot(target) },
  };
}
export async function commentDeletionReadSummary(
  row: typeof schema.pendingActionTable.$inferSelect,
  executor: typeof db | PendingActionTransaction,
  viewer?: ResolvedIdentity,
): Promise<Record<string, unknown> | undefined> {
  const [actor] = await executor
    .select({ userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, row.requestedByPersonId));
  const identity =
    viewer ??
    (actor?.userId
      ? await resolveIdentity(
          { userId: actor.userId, credential: "session" },
          executor,
        )
      : null);
  if (!identity || identity.personId !== row.requestedByPersonId)
    return undefined;
  const [target] = await executor
    .select({
      item: schema.workItemTable,
      project: schema.projectTable,
      commentDeletedAt: schema.commentTable.deletedAt,
    })
    .from(schema.commentTable)
    .innerJoin(
      schema.workItemTable,
      eq(schema.workItemTable.id, schema.commentTable.workItemId),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.commentTable.id, row.targetIds[0] ?? ""),
        eq(schema.workItemTable.workspaceId, row.workspaceId ?? ""),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .limit(1);
  if (!target || !readable(identity, target)) return undefined;
  const summary = row.payloadSummary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    return undefined;
  const fields = summary as Record<string, unknown>;
  // CA17/18: current tombstones never disclose former bodies through historical confirmations.
  // Executed actions also stay body-free if an unsupported/out-of-band writer changes the row.
  const alreadyDeleted =
    row.state === "executed" ||
    target.commentDeletedAt !== null ||
    fields.alreadyDeleted === true;
  return {
    commentId: fields.commentId,
    key: fields.key,
    title: fields.title,
    visibility: fields.visibility,
    requesterName: fields.requesterName,
    alreadyDeleted,
    commentBody: alreadyDeleted ? null : (fields.commentBody ?? null),
  };
}
export async function approveCommentDeletion(
  input: ClickDeletionApprovalInput,
) {
  return approveClickDeletion(input, {
    targetType: "comment",
    routeKey: COMMENT_DELETION_ROUTE,
    execute: failOnExecutorError(async (tx, row) => {
      const deleted = await deleteCommentInTransaction(
        tx,
        row.targetIds[0] ?? "",
        row.workspaceId ?? "",
        input.userId,
      );
      // The preview is no longer needed after the confirmed deletion. The immutable
      // payload/hash and restricted comment audit remain unchanged.
      const summary = row.payloadSummary;
      await tx
        .update(schema.pendingActionTable)
        .set({
          payloadSummary: {
            ...(summary &&
            typeof summary === "object" &&
            !Array.isArray(summary)
              ? summary
              : {}),
            commentBody: null,
            alreadyDeleted: true,
          },
        })
        .where(eq(schema.pendingActionTable.id, row.id));
      return deleted;
    }),
  });
}
