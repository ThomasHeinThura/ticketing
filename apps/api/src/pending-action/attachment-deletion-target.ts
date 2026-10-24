import { createHash } from "node:crypto";
import { can, type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  attachmentDeletionAccess,
  loadAttachmentCaller,
} from "../attachment/access";
import { deleteAttachmentInTransaction } from "../attachment/controllers/delete-attachment";
import type db from "../database";
import { schema } from "../database";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
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

export const ATTACHMENT_DELETION_ROUTE =
  "DELETE /api/attachments/{id}" as const;

/** Lifecycle gate precedes parent, project, then attachment. The live parent fences moves/deletion. */
export async function loadAttachmentDeletionTarget(
  tx: PendingActionTransaction,
  id: string,
) {
  const [anchor] = await tx
    .select()
    .from(schema.attachmentTable)
    .where(eq(schema.attachmentTable.id, id))
    .limit(1);
  if (!anchor?.workItemId || anchor.commentId || anchor.submissionId)
    return undefined;
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
  const [attachment] = await tx
    .select()
    .from(schema.attachmentTable)
    .where(
      and(
        eq(schema.attachmentTable.id, id),
        eq(schema.attachmentTable.workItemId, item.id),
        eq(schema.attachmentTable.workspaceId, item.workspaceId),
      ),
    )
    .for("update")
    .limit(1);
  if (!attachment) return undefined;
  const [precise] = await tx
    .select({
      row: sql<string>`to_jsonb(${schema.attachmentTable})::text`,
      deletedAt: sql<string | null>`${schema.attachmentTable.deletedAt}::text`,
    })
    .from(schema.attachmentTable)
    .where(eq(schema.attachmentTable.id, id));
  if (!precise) return undefined;
  return { attachment, item, project, precise };
}
type Target = NonNullable<
  Awaited<ReturnType<typeof loadAttachmentDeletionTarget>>
>;
function snapshot(target: Target) {
  return {
    attachmentId: target.attachment.id,
    workItemId: target.item.id,
    key: target.item.key,
    workspaceId: target.item.workspaceId,
    projectId: target.item.projectId,
    parentVersion: target.item.version,
    uploadedBy: target.attachment.uploadedBy,
    state: target.attachment.state,
    rowHash: createHash("sha256").update(target.precise.row).digest("hex"),
    deletedAt: target.precise?.deletedAt ?? null,
  };
}
async function readable(
  executor: object,
  identity: ResolvedIdentity,
  target: Pick<Target, "item" | "project">,
) {
  const ancestorProjectIds = await projectAncestryFor(
    executor,
    identity,
    target.item.workspaceId,
    target.item.projectId,
  );
  const ownerTeamId = await projectOwnerTeamFor(
    executor,
    identity,
    target.item.workspaceId,
    target.item.projectId,
  );
  return (
    reaches(identity, {
      workspaceId: target.item.workspaceId,
      projectId: target.item.projectId,
      organisationId: target.project.organisationId,
      ancestorProjectIds,
      ownerTeamId,
    }) &&
    can(identity, "work_item:read", "work_item", {
      workspaceId: target.item.workspaceId,
      workItemProjectId: target.item.projectId,
      workItemId: target.item.id,
      ancestorProjectIds,
    })
  );
}
export async function evaluateAttachmentDeletionAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
): Promise<RequiredAccessDecision> {
  if (
    input.action !== "delete" ||
    input.targetType !== "attachment" ||
    input.routeKey !== ATTACHMENT_DELETION_ROUTE ||
    input.targetIds.length !== 1 ||
    input.confirmationRequired !== "click"
  )
    return { allowed: false, failure: "unsupported", status: 403 };
  const target = await loadAttachmentDeletionTarget(
    tx,
    input.targetIds[0] ?? "",
  );
  if (
    !target ||
    target.item.workspaceId !== input.workspaceId ||
    target.item.projectId !== input.projectId ||
    target.project.organisationId !== input.organisationId
  )
    return { allowed: false, failure: "target_scope", status: 404 };
  if (!(await readable(tx, identity, target)))
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
  const caller = await loadAttachmentCaller(tx, identity, {
    workspaceId: target.item.workspaceId,
    projectId: target.item.projectId,
    workItemId: target.item.id,
  });
  if (!attachmentDeletionAccess(caller, target.attachment).mayDelete)
    return { allowed: false, failure: "capability", status: 403 };
  if (input.payload !== undefined || input.targetVersions != null) {
    const versions = input.targetVersions as Record<string, unknown> | null;
    if (
      !versions ||
      JSON.stringify(versions[target.attachment.id]) !==
        JSON.stringify(snapshot(target))
    ) {
      // JSONB does not retain object key order.
      const stored = versions?.[target.attachment.id];
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
export async function resolveAttachmentDeletionRequestScope(
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
  const target = await loadAttachmentDeletionTarget(
    tx,
    input.targetIds[0] ?? "",
  );
  if (!target)
    throw new HTTPException(404, { message: "Attachment not found" });
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
    throw new HTTPException(404, { message: "Attachment not found" });
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
      message: access.status === 404 ? "Attachment not found" : "Forbidden",
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
      attachmentId: target.attachment.id,
      key: target.item.key,
      title: target.item.title,
      filename: target.attachment.filename,
      mimeType: target.attachment.mimeType,
      size: target.attachment.size,
      recoveryHours: 24,
      alreadyDeleted: target.attachment.state === "deleted",
      requesterName: actor.name,
    },
    targetVersions: { [target.attachment.id]: snapshot(target) },
  };
}
export async function attachmentDeletionReadSummary(
  row: typeof schema.pendingActionTable.$inferSelect,
  executor: typeof db | PendingActionTransaction,
  viewer?: ResolvedIdentity,
): Promise<Record<string, unknown> | undefined> {
  const versions = row.targetVersions;
  if (!versions || typeof versions !== "object" || Array.isArray(versions))
    return undefined;
  const frozen = (versions as Record<string, unknown>)[row.targetIds[0] ?? ""];
  if (
    !frozen ||
    typeof frozen !== "object" ||
    Array.isArray(frozen) ||
    !("workItemId" in frozen) ||
    typeof frozen.workItemId !== "string"
  )
    return undefined;
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
    .select({ item: schema.workItemTable, project: schema.projectTable })
    .from(schema.attachmentTable)
    .innerJoin(
      schema.workItemTable,
      eq(schema.workItemTable.id, schema.attachmentTable.workItemId),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.attachmentTable.id, row.targetIds[0] ?? ""),
        eq(schema.workItemTable.id, frozen.workItemId),
        eq(schema.workItemTable.workspaceId, row.workspaceId ?? ""),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .limit(1);
  if (!target || !(await readable(executor, identity, target)))
    return undefined;
  return row.payloadSummary as Record<string, unknown>;
}
export async function approveAttachmentDeletion(
  input: ClickDeletionApprovalInput,
) {
  return approveClickDeletion(input, {
    targetType: "attachment",
    routeKey: ATTACHMENT_DELETION_ROUTE,
    execute: failOnExecutorError(async (tx, row) => {
      const target = await loadAttachmentDeletionTarget(
        tx,
        row.targetIds[0] ?? "",
      );
      if (!target)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      return deleteAttachmentInTransaction(
        tx,
        target.attachment,
        target.item,
        input.userId,
        "person",
      );
    }),
  });
}
