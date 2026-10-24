import { can, type ResolvedIdentity, reaches } from "@taskdesk/permissions";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { schema } from "../database";
import { workItemRelationTable } from "../database/schema";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import { lockRelationGraph } from "../work-item-relation/blockers";
import {
  deleteWorkItemRelationInTransaction,
  publishRelationHints,
} from "../work-item-relation/service";
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

export const RELATION_DELETION_ROUTE =
  "DELETE /api/work-items/{key}/relations/{id}" as const;

/** Read, lock both ends in stable order, then lock/recheck the immutable relation tuple. */
export async function loadRelationDeletionTarget(
  tx: PendingActionTransaction,
  relationId: string,
) {
  const [candidate] = await tx
    .select()
    .from(workItemRelationTable)
    .where(eq(workItemRelationTable.id, relationId))
    .limit(1);
  if (!candidate) return undefined;
  const [graphAnchor] = await tx
    .select({ workspaceId: schema.workItemTable.workspaceId })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, candidate.sourceId))
    .limit(1);
  if (!graphAnchor) return undefined;
  // Final-blocker detection shares this workspace graph gate with create/transition/delete.
  // The lifecycle lock (held by callers) comes first, then graph, items and projects.
  await lockRelationGraph(tx, graphAnchor.workspaceId);
  const endpoints = await tx
    .select({
      id: schema.workItemTable.id,
      key: schema.workItemTable.key,
      title: schema.workItemTable.title,
      version: schema.workItemTable.version,
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
        inArray(schema.workItemTable.id, [
          candidate.sourceId,
          candidate.targetId,
        ]),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .orderBy(asc(schema.workItemTable.id))
    .for("update", { of: schema.workItemTable });
  // Match relation mutation lock order: every item first, then projects in ID order.
  // Locking joined projects FOR UPDATE here would invert the shared-project lock path.
  const projectIds = [
    ...new Set(endpoints.map((endpoint) => endpoint.projectId)),
  ].sort();
  if (projectIds.length === 0) return undefined;
  const projects = await tx
    .select({
      id: schema.projectTable.id,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.projectTable)
    .where(
      and(
        inArray(schema.projectTable.id, projectIds),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .orderBy(asc(schema.projectTable.id))
    .for("share");
  if (projects.length !== projectIds.length) return undefined;
  for (const endpoint of endpoints)
    endpoint.organisationId =
      projects.find((project) => project.id === endpoint.projectId)
        ?.organisationId ?? null;
  const source = endpoints.find(
    (endpoint) => endpoint.id === candidate.sourceId,
  );
  const target = endpoints.find(
    (endpoint) => endpoint.id === candidate.targetId,
  );
  if (
    !source ||
    !target ||
    source.workspaceId !== target.workspaceId ||
    source.workspaceId !== graphAnchor.workspaceId
  )
    return undefined;
  const [relation] = await tx
    .select()
    .from(workItemRelationTable)
    .where(eq(workItemRelationTable.id, relationId))
    .for("update")
    .limit(1);
  if (
    !relation ||
    relation.sourceId !== source.id ||
    relation.targetId !== target.id ||
    relation.type !== candidate.type
  )
    return undefined;
  return { relation, source, target };
}

type Target = NonNullable<
  Awaited<ReturnType<typeof loadRelationDeletionTarget>>
>;
function snapshot(target: Target) {
  return {
    sourceId: target.source.id,
    targetId: target.target.id,
    type: target.relation.type,
    updatedAt: target.relation.updatedAt.toISOString(),
    sourceVersion: target.source.version,
    targetVersion: target.target.version,
    sourceKey: target.source.key,
    targetKey: target.target.key,
    sourceProjectId: target.source.projectId,
    targetProjectId: target.target.projectId,
    workspaceId: target.source.workspaceId,
  };
}

export async function relationDeletionEndpointAccess(
  executor: object,
  identity: ResolvedIdentity,
  endpoint: Target["source"],
): Promise<RequiredAccessDecision> {
  const ancestorProjectIds = await projectAncestryFor(
    executor,
    identity,
    endpoint.workspaceId,
    endpoint.projectId,
  );
  const ownerTeamId = await projectOwnerTeamFor(
    executor,
    identity,
    endpoint.workspaceId,
    endpoint.projectId,
  );
  if (
    !reaches(identity, {
      projectId: endpoint.projectId,
      workspaceId: endpoint.workspaceId,
      organisationId: endpoint.organisationId,
      ancestorProjectIds,
      ownerTeamId,
    })
  )
    return { allowed: false, failure: "reach", status: 404 };
  if (
    !can(identity, "work_item:update", "work_item", {
      workItemId: endpoint.id,
      workItemProjectId: endpoint.projectId,
      workspaceId: endpoint.workspaceId,
      ancestorProjectIds,
    })
  )
    return { allowed: false, failure: "capability", status: 403 };
  return { allowed: true };
}

/** Called by the common PA-9 evaluator after resolving the actual originating credential. */
export async function evaluateRelationDeletionAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
): Promise<RequiredAccessDecision> {
  const route = policyRegistry.get(RELATION_DELETION_ROUTE);
  if (
    input.action !== "delete" ||
    input.targetType !== "relation" ||
    input.routeKey !== RELATION_DELETION_ROUTE ||
    input.targetIds.length !== 1 ||
    input.confirmationRequired !== "click" ||
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.capability !== "work_item:update" ||
    route.policy.scope !== "work_item" ||
    route.policy.reach !== "required"
  )
    return { allowed: false, failure: "unsupported", status: 403 };
  const target = await loadRelationDeletionTarget(tx, input.targetIds[0] ?? "");
  if (
    !target ||
    target.source.workspaceId !== input.workspaceId ||
    target.source.projectId !== input.projectId ||
    target.source.organisationId !== input.organisationId
  )
    return { allowed: false, failure: "target_scope", status: 404 };
  for (const endpoint of [target.source, target.target]) {
    const decision = await relationDeletionEndpointAccess(
      tx,
      identity,
      endpoint,
    );
    if (!decision.allowed) return decision;
  }
  if (
    input.payload !== undefined ||
    (input.targetVersions !== undefined && input.targetVersions !== null)
  ) {
    if (
      typeof input.targetVersions !== "object" ||
      input.targetVersions === null ||
      Array.isArray(input.targetVersions)
    )
      return { allowed: false, failure: "target_version", status: 409 };
    const versions = input.targetVersions as Record<string, unknown>;
    const stored = versions[target.relation.id];
    const expected = snapshot(target);
    if (
      typeof stored !== "object" ||
      stored === null ||
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

export async function resolveRelationDeletionRequestScope(
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
  const target = await loadRelationDeletionTarget(tx, input.targetIds[0] ?? "");
  if (!target) throw new HTTPException(404, { message: "Relation not found" });
  const scope = {
    workspaceId: target.source.workspaceId,
    projectId: target.source.projectId,
    organisationId: target.source.organisationId,
  };
  if (
    (input.workspaceId !== undefined &&
      input.workspaceId !== scope.workspaceId) ||
    (input.projectId !== undefined && input.projectId !== scope.projectId) ||
    (input.organisationId !== undefined &&
      input.organisationId !== scope.organisationId)
  )
    throw new HTTPException(404, { message: "Relation not found" });
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
      message: access.status === 404 ? "Relation not found" : "Forbidden",
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
  if (!actor || actor.userId !== input.actorId)
    throw new HTTPException(403, { message: "Forbidden" });
  return {
    ...scope,
    actorName: actor.name,
    summary: {
      relationId: target.relation.id,
      relationType: target.relation.type,
      sourceKey: target.source.key,
      sourceTitle: target.source.title,
      targetKey: target.target.key,
      targetTitle: target.target.title,
      requesterName: actor.name,
    },
    targetVersions: { [target.relation.id]: snapshot(target) },
  };
}

/** A historical confirmation is not permission to redisclose an inaccessible peer. */
export async function relationDeletionReadSummary(
  row: typeof schema.pendingActionTable.$inferSelect,
  executor: typeof db | PendingActionTransaction,
  viewer?: ResolvedIdentity,
): Promise<Record<string, unknown> | undefined> {
  if (
    row.targetIds.length !== 1 ||
    typeof row.targetVersions !== "object" ||
    row.targetVersions === null ||
    Array.isArray(row.targetVersions)
  )
    return undefined;
  const frozen = (row.targetVersions as Record<string, unknown>)[
    row.targetIds[0] ?? ""
  ];
  if (typeof frozen !== "object" || frozen === null || Array.isArray(frozen))
    return undefined;
  const snapshot = frozen as Record<string, unknown>;
  if (
    typeof snapshot.sourceId !== "string" ||
    typeof snapshot.targetId !== "string" ||
    snapshot.sourceId === snapshot.targetId
  )
    return undefined;
  const [actor] = await executor
    .select({ userId: schema.personTable.userId })
    .from(schema.personTable)
    .where(eq(schema.personTable.id, row.requestedByPersonId))
    .limit(1);
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
  const endpoints = await executor
    .select({
      id: schema.workItemTable.id,
      key: schema.workItemTable.key,
      title: schema.workItemTable.title,
      version: schema.workItemTable.version,
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
        inArray(schema.workItemTable.id, [
          snapshot.sourceId,
          snapshot.targetId,
        ]),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    );
  if (endpoints.length !== 2) return undefined;
  for (const endpoint of endpoints) {
    if (endpoint.workspaceId !== row.workspaceId) return undefined;
    const ancestorProjectIds = await projectAncestryFor(
      executor,
      identity,
      endpoint.workspaceId,
      endpoint.projectId,
    );
    const ownerTeamId = await projectOwnerTeamFor(
      executor,
      identity,
      endpoint.workspaceId,
      endpoint.projectId,
    );
    if (
      !reaches(identity, {
        projectId: endpoint.projectId,
        workspaceId: endpoint.workspaceId,
        organisationId: endpoint.organisationId,
        ancestorProjectIds,
        ownerTeamId,
      }) ||
      !can(identity, "work_item:read", "work_item", {
        workItemId: endpoint.id,
        workItemProjectId: endpoint.projectId,
        workspaceId: endpoint.workspaceId,
        ancestorProjectIds,
      })
    )
      return undefined;
  }
  const summary = row.payloadSummary;
  return typeof summary === "object" &&
    summary !== null &&
    !Array.isArray(summary)
    ? (summary as Record<string, unknown>)
    : undefined;
}

export async function approveRelationDeletion(
  input: ClickDeletionApprovalInput,
) {
  return approveClickDeletion(input, {
    targetType: "relation",
    routeKey: RELATION_DELETION_ROUTE,
    execute: failOnExecutorError(async (tx, row) => {
      const target = await loadRelationDeletionTarget(
        tx,
        row.targetIds[0] ?? "",
      );
      if (!target)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      const identity = await resolveIdentity(
        { userId: input.userId, credential: "session" },
        tx,
      );
      if (!identity) throw new HTTPException(403, { message: "Forbidden" });
      await deleteWorkItemRelationInTransaction(tx, {
        relationId: target.relation.id,
        key: target.source.key,
        workspaceId: target.source.workspaceId,
        actorId: input.userId,
        actorType: "person",
        authorize: async (endpoint) => {
          const loaded =
            endpoint.id === target.source.id
              ? target.source
              : endpoint.id === target.target.id
                ? target.target
                : undefined;
          const access =
            loaded &&
            (await relationDeletionEndpointAccess(tx, identity, loaded));
          if (!access?.allowed)
            throw new HTTPException(403, { message: "Forbidden" });
        },
      });
      return [target.source, target.target];
    }),
    afterCommit: publishRelationHints,
  });
}
