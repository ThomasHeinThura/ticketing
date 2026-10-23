import { can, type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { schema } from "../database";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import { projectAncestryFor } from "../utils/project-ancestry";
import {
  deleteWorkItemInTransaction,
  publishWorkItemDeletion,
} from "../work-item/controllers/delete-work-item";
import { WORK_ITEM_HIERARCHY_LOCK_NAMESPACE } from "../work-item/hierarchy-lock";
import { lockRelationGraph } from "../work-item-relation/blockers";
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

export const WORK_ITEM_DELETION_ROUTE = "DELETE /api/work-items/{key}" as const;
export async function loadWorkItemDeletionTarget(
  tx: PendingActionTransaction,
  key: string,
) {
  const [anchor] = await tx
    .select({
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
    })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.key, key))
    .limit(1);
  if (!anchor) return undefined;
  await lockRelationGraph(tx, anchor.workspaceId);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${WORK_ITEM_HIERARCHY_LOCK_NAMESPACE}, hashtext(${anchor.projectId}))`,
  );
  const [item] = await tx
    .select()
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.key, key),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (
    !item ||
    item.workspaceId !== anchor.workspaceId ||
    item.projectId !== anchor.projectId
  )
    return undefined;
  const [project] = await tx
    .select({
      id: schema.projectTable.id,
      name: schema.projectTable.name,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, item.projectId),
        eq(schema.projectTable.workspaceId, item.workspaceId),
        isNull(schema.projectTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .for("share")
    .limit(1);
  const [workspace] = await tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, item.workspaceId))
    .limit(1);
  if (!project || !workspace) return undefined;
  // The project hierarchy lock freezes the child set while a deletion is requested/executed.
  const children = await tx
    .select({ id: schema.workItemTable.id })
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.parentId, item.id),
        isNull(schema.workItemTable.deletedAt),
      ),
    )
    .orderBy(asc(schema.workItemTable.id))
    .for("share");
  return {
    item,
    project,
    scopeOrganisationId: workspace.organisationId,
    children,
  };
}
type Target = NonNullable<
  Awaited<ReturnType<typeof loadWorkItemDeletionTarget>>
>;
export function workItemDeletionSnapshot(target: Target) {
  return {
    id: target.item.id,
    key: target.item.key,
    version: target.item.version,
    workspaceId: target.item.workspaceId,
    projectId: target.item.projectId,
    parentId: target.item.parentId,
    childIds: target.children.map((child) => child.id).join(","),
  };
}
export async function workItemDeletionAccess(
  executor: object,
  identity: ResolvedIdentity,
  target: Target,
): Promise<RequiredAccessDecision> {
  // PR-2/PR-3: reach and authority both follow the ancestor chain.
  const ancestorProjectIds = await projectAncestryFor(
    executor,
    identity,
    target.item.workspaceId,
    target.item.projectId,
  );
  if (
    !reaches(identity, {
      projectId: target.item.projectId,
      workspaceId: target.item.workspaceId,
      organisationId: target.project.organisationId,
      ancestorProjectIds,
    })
  )
    return { allowed: false, failure: "reach", status: 404 };
  return can(identity, "work_item:delete", "work_item", {
    workItemId: target.item.id,
    workItemProjectId: target.item.projectId,
    workspaceId: target.item.workspaceId,
    ancestorProjectIds,
  })
    ? { allowed: true }
    : { allowed: false, failure: "capability", status: 403 };
}
export async function evaluateWorkItemDeletionAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
): Promise<RequiredAccessDecision> {
  const route = policyRegistry.get(WORK_ITEM_DELETION_ROUTE);
  if (
    input.action !== "delete" ||
    input.targetType !== "work_item" ||
    input.routeKey !== WORK_ITEM_DELETION_ROUTE ||
    input.targetIds.length !== 1 ||
    input.confirmationRequired !== "click" ||
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.capability !== "work_item:delete" ||
    route.policy.scope !== "work_item" ||
    route.policy.reach !== "required"
  )
    return { allowed: false, failure: "unsupported", status: 403 };
  const target = await loadWorkItemDeletionTarget(tx, input.targetIds[0] ?? "");
  if (
    !target ||
    target.item.workspaceId !== input.workspaceId ||
    target.item.projectId !== input.projectId ||
    target.scopeOrganisationId !== input.organisationId
  )
    return { allowed: false, failure: "target_scope", status: 404 };
  const access = await workItemDeletionAccess(tx, identity, target);
  if (!access.allowed) return access;
  if (
    input.payload !== undefined ||
    (input.targetVersions !== undefined && input.targetVersions !== null)
  ) {
    const versions = input.targetVersions;
    const stored =
      versions && typeof versions === "object" && !Array.isArray(versions)
        ? (versions as Record<string, unknown>)[target.item.key]
        : undefined;
    const expected = workItemDeletionSnapshot(target);
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
  return { allowed: true };
}
export async function resolveWorkItemDeletionRequestScope(
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
  const target = await loadWorkItemDeletionTarget(tx, input.targetIds[0] ?? "");
  if (!target) throw new HTTPException(404, { message: "Work item not found" });
  const scope = {
    workspaceId: target.item.workspaceId,
    projectId: target.item.projectId,
    organisationId: target.scopeOrganisationId,
  };
  if (
    (input.workspaceId !== undefined &&
      input.workspaceId !== scope.workspaceId) ||
    (input.projectId !== undefined && input.projectId !== scope.projectId) ||
    (input.organisationId !== undefined &&
      input.organisationId !== scope.organisationId)
  )
    throw new HTTPException(404, { message: "Work item not found" });
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
      message: access.status === 404 ? "Work item not found" : "Forbidden",
    });
  const [actor] = await tx
    .select({ userId: schema.personTable.userId, name: schema.userTable.name })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(eq(schema.personTable.id, input.requesterPersonId))
    .limit(1);
  if (
    !actor ||
    (input.actorId !== actor.userId &&
      !(
        input.actorType === "person" &&
        input.actorId === input.requesterPersonId
      ))
  )
    throw new HTTPException(403, { message: "Forbidden" });
  return {
    ...scope,
    actorName: actor.name,
    summary: {
      key: target.item.key,
      title: target.item.title,
      projectName: target.project.name,
      childrenAffected: target.children.length,
      requesterName: actor.name,
    },
    targetVersions: { [target.item.key]: workItemDeletionSnapshot(target) },
  };
}
export async function workItemDeletionReadSummary(
  row: typeof schema.pendingActionTable.$inferSelect,
  executor: typeof db | PendingActionTransaction,
  viewer?: ResolvedIdentity,
): Promise<Record<string, unknown> | undefined> {
  const [requester] = await executor
    .select({ userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, row.requestedByPersonId))
    .limit(1);
  const identity =
    viewer ??
    (requester?.userId
      ? await resolveIdentity(
          { userId: requester.userId, credential: "session" },
          executor,
        )
      : null);
  if (
    !identity ||
    identity.personId !== row.requestedByPersonId ||
    row.targetIds.length !== 1
  )
    return undefined;
  const [target] = await executor
    .select({
      id: schema.workItemTable.id,
      projectId: schema.workItemTable.projectId,
      workspaceId: schema.workItemTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.workItemTable.key, row.targetIds[0] ?? ""),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .limit(1);
  if (!target || target.workspaceId !== row.workspaceId) return undefined;
  const ancestorProjectIds = await projectAncestryFor(
    executor,
    identity,
    target.workspaceId,
    target.projectId,
  );
  if (
    !reaches(identity, { ...target, ancestorProjectIds }) ||
    !can(identity, "work_item:read", "work_item", {
      workItemId: target.id,
      workItemProjectId: target.projectId,
      workspaceId: target.workspaceId,
      ancestorProjectIds,
    })
  )
    return undefined;
  return typeof row.payloadSummary === "object" &&
    row.payloadSummary !== null &&
    !Array.isArray(row.payloadSummary)
    ? (row.payloadSummary as Record<string, unknown>)
    : undefined;
}
export async function approveWorkItemDeletion(
  input: ClickDeletionApprovalInput,
) {
  return approveClickDeletion(input, {
    targetType: "work_item",
    routeKey: WORK_ITEM_DELETION_ROUTE,
    execute: failOnExecutorError(async (tx, row) => {
      const target = await loadWorkItemDeletionTarget(
        tx,
        row.targetIds[0] ?? "",
      );
      if (!target)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      return deleteWorkItemInTransaction(
        tx,
        target.item.key,
        target.item.workspaceId,
        input.userId,
        "person",
      );
    }),
    afterCommit: publishWorkItemDeletion,
  });
}
