import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import type { PolicyMap, ResolvedIdentity } from "@taskdesk/permissions";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  assertKeyHasApprover,
  pendingActionOriginForKey,
} from "../api-key/credential";
import { loadApiKeyKind } from "../api-key/repository";
import { appendAuditLog } from "../audit/audit-writer";
import { currentImpersonatorId } from "../auth/impersonation-context";
import { appendPendingActionStepUpAudit } from "../auth/step-up-audit";
import { consumePendingActionProof } from "../auth/step-up-service";
import db, { schema } from "../database";
import {
  apikeyTable,
  pendingActionTable,
  personTable,
  savedViewTable,
  serviceCalendarTable,
  userTable,
} from "../database/schema";
import { enqueueOutboxEvent } from "../events/outbox";
import { databaseErrorCode } from "../identity/grant-closure-retry";
import {
  IdentityGrantClosureChangedError,
  retryIdentityGrantClosure,
} from "../identity/membership-projection";
import {
  lockPersonLifecycleClosureInTransaction,
  transitionPersonLifecycleInTransaction,
} from "../identity/person-lifecycle";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  HARD_PURGE_TARGET_TYPES,
  type HardPurgeTargetType,
  inspectHardPurgeTarget,
} from "../instance/purge-target";
import {
  assertAdminRemovalAllowed,
  lockInstanceAdminSerialization,
} from "../instance/users/repository";
import { enqueueNotificationEvent } from "../notification/fanout";
import { resolvePendingActionEventRecipients } from "../notification/recipient-resolvers";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import { dbNowUtc } from "../utils/db-time";
import {
  apiKeyCapabilitySubset,
  apiKeyScopeFromStoredPermissions,
} from "../utils/require-api-key-permission-scope";
import { invalidateNativeAuthorization } from "../ws";
import { resolvePendingActionApprovalContract } from "./approval-contract";
import {
  ATTACHMENT_DELETION_ROUTE,
  attachmentDeletionReadSummary,
  resolveAttachmentDeletionRequestScope,
} from "./attachment-deletion-target";
import {
  BULK_WORK_ITEM_DELETION_ROUTE,
  bulkWorkItemDeletionReadSummary,
  resolveBulkWorkItemDeletionRequestScope,
} from "./bulk-work-item-deletion-target";
import {
  COMMENT_DELETION_ROUTE,
  commentDeletionReadSummary,
  resolveCommentDeletionRequestScope,
} from "./comment-deletion-target";
import {
  isRegisteredDeletion,
  resolveRegisteredDeletionRequestScope,
} from "./deletion-targets";
import { failOnExecutorError } from "./execution-failure";
import {
  lockPendingActionLifecycle,
  pendingActionEventScope,
} from "./lifecycle-invalidation";
import {
  type ConfirmationKind,
  canonicalPendingActionPayload,
  hashPendingActionPayload,
  MCP_APPROVAL_DECISION_ROUTE,
  type McpApprovalDecision,
  type PendingActionKind,
  requiredConfirmation,
} from "./payload";
import { readPendingActionTargetWorkspace } from "./read-target-workspace";
import {
  RELATION_DELETION_ROUTE,
  relationDeletionReadSummary,
  resolveRelationDeletionRequestScope,
} from "./relation-deletion-target";
import { evaluateActionRequiredAccess } from "./required-access";
import { pendingActionReadSchema } from "./response";
import {
  resolveWorkItemDeletionRequestScope,
  WORK_ITEM_DELETION_ROUTE,
  workItemDeletionReadSummary,
} from "./work-item-deletion-target";

const ACTION_TTL_MS = 15 * 60 * 1000;
/** SQLSTATEs `retryIdentityGrantClosure` retries rather than surfaces. */
const RETRIED_GRANT_CLOSURE_CONFLICTS = new Set([
  "40P01",
  "40001",
  "23503",
  "23505",
]);

export type CreatePendingActionInput = {
  requesterPersonId: string;
  credentialType: "session" | "api_key";
  credentialId: string | null;
  origin: "web" | "api" | "mcp";
  action: PendingActionKind;
  routeKey: keyof PolicyMap;
  targetType: string;
  targetIds: readonly string[];
  /** PA-14's exact decision intent; accepted only by its registered MCP target. */
  mcpDecision?: McpApprovalDecision;
  /** Internal server-side import binding; never accepted from a request body. */
  importChunk?: {
    routeKey: "POST /api/imports/{id}/records" | "POST /api/imports/{id}/links";
    runId: string;
    chunkId: string;
    operation: "records" | "links";
    digest: string;
    expectedRunVersion: number;
    recordCount: number;
  };
  /** Internal server-side run-level import approval binding (P6 D2); never accepted from a request body. */
  importRun?: {
    runId: string;
    digest: string;
    totalCount: number;
    mappingVersion: number;
    writes: number;
  };
  /** Rejected until PA-6 defines a target-version encoding. */
  targetVersions?: Record<string, unknown> | null;
  /** Optional scope assertions. Persisted scope always comes from target rows. */
  workspaceId?: string | null;
  projectId?: string | null;
  organisationId?: string | null;
  actorId: string;
  actorType: "person" | "api_key";
  actorIp?: string | null;
  userAgent?: string | null;
};

/**
 * F13 / PA-5a: a key credential's pending-action origin comes from the key's stored `is_mcp`
 * flag, never from the calling route, and a workspace service key (no person) has no approver
 * and is refused `403 no_approver`. A `web` origin on a key credential is left alone so the
 * target's own credential validation still refuses it.
 */
async function bindKeyCredentialOrigin(
  requested: CreatePendingActionInput,
  executor?: PendingActionTransaction,
): Promise<CreatePendingActionInput> {
  if (requested.credentialType !== "api_key" || !requested.credentialId?.trim())
    return requested;
  const key = await loadApiKeyKind(requested.credentialId, executor);
  assertKeyHasApprover(key);
  if (requested.origin === "web") return requested;
  return { ...requested, origin: pendingActionOriginForKey(key) };
}

export type PendingActionRequestResult = {
  pendingActionId: string;
  action: PendingActionKind;
  summary: Record<string, unknown>;
  confirmation: ConfirmationKind;
  expiresAt: string;
  approveUrl: string;
  auditFailure: boolean;
};

/**
 * Create a pending action inside a caller-owned transaction. Import chunks use this so
 * staging the operation and creating its approval request are one atomic commit.
 */
export async function createPendingActionInTransaction(
  tx: PendingActionTransaction,
  requested: CreatePendingActionInput,
): Promise<PendingActionRequestResult> {
  if (currentImpersonatorId() !== null)
    throw new HTTPException(403, {
      message:
        "impersonation: requesting a deletion is not allowed during an impersonation session",
    });
  const input = await bindKeyCredentialOrigin(requested, tx);
  assertRegisteredRouteKey(input.routeKey);
  if (input.targetVersions !== undefined && input.targetVersions !== null)
    throw new TypeError(
      "Caller-supplied pending-action target versions are not supported",
    );
  if (input.credentialType === "api_key" && !input.credentialId?.trim())
    throw new HTTPException(403, {
      message: "API-key pending actions require an authenticated key ID",
    });

  await lockPendingActionLifecycle(tx);
  const scope = await resolveRequestScope(tx, input);
  const executionTargetIds = scope.executionTargetIds ?? input.targetIds;
  const confirmation =
    scope.confirmationRequired ??
    requiredConfirmation({
      action: input.action,
      targetType: input.targetType,
      targetCount: executionTargetIds.length,
    });
  const payload = canonicalPendingActionPayload({
    action: input.action,
    route_key: input.routeKey,
    target_type: input.targetType,
    target_ids: executionTargetIds,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    organisation_id: scope.organisationId,
    confirmation_required: confirmation,
    ...(input.mcpDecision ? { mcp_decision: input.mcpDecision } : {}),
  });
  const now = new Date();
  const id = createId();
  const traceId = createId();
  const expiresAt = new Date(now.getTime() + ACTION_TTL_MS);
  const [created] = await tx
    .insert(pendingActionTable)
    .values({
      id,
      requestedByPersonId: input.requesterPersonId,
      credentialType: input.credentialType,
      credentialId: input.credentialId,
      origin: input.origin,
      action: input.action,
      targetType: input.targetType,
      targetIds: payload.target_ids,
      targetVersions: scope.targetVersions ?? null,
      payload,
      routeKey: input.routeKey,
      payloadHash: hashPendingActionPayload(payload),
      payloadSummary: scope.summary,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      organisationId: scope.organisationId,
      confirmationRequired: confirmation,
      state: "pending",
      createdAt: now,
      expiresAt,
      traceId,
    })
    .onConflictDoNothing()
    .returning({ id: pendingActionTable.id });
  if (!created) {
    const [existing] = await tx
      .select({ id: pendingActionTable.id })
      .from(pendingActionTable)
      .where(
        and(
          eq(pendingActionTable.requestedByPersonId, input.requesterPersonId),
          eq(pendingActionTable.action, input.action),
          eq(pendingActionTable.targetIds, payload.target_ids),
          eq(pendingActionTable.state, "pending"),
        ),
      )
      .limit(1);
    if (existing)
      throw new HTTPException(409, {
        message: `pending_approval: ${existing.id}`,
      });
    throw new HTTPException(409, { message: "pending_action_conflict" });
  }

  const keyActor =
    input.credentialType === "api_key" &&
    input.credentialId &&
    (input.origin === "api" || input.origin === "mcp")
      ? await tx
          .select({ id: apikeyTable.id, name: apikeyTable.name })
          .from(apikeyTable)
          .where(eq(apikeyTable.id, input.credentialId))
          .limit(1)
          .then(([key]) => key)
      : undefined;
  await enqueueNotificationEvent(
    tx,
    {
      id: `evt_${createId()}`,
      kind: "pending_action.requested",
      occurredAt: now.toISOString(),
      actor: keyActor
        ? { type: "api_key", id: keyActor.id, name: keyActor.name ?? "API key" }
        : {
            type: "person",
            id: input.requesterPersonId,
            name: scope.actorName,
          },
      scope: pendingActionEventScope({
        action: input.action,
        targetType: input.targetType,
        routeKey: input.routeKey,
        targetIds: executionTargetIds,
        ...scope,
      }),
      payload: {
        key: id,
        url: `/agent/settings/profile/pending-actions/${id}`,
        pendingActionId: id,
        action: input.action,
        origin: input.origin,
        targetType: input.targetType,
        targetCount: payload.target_ids.length,
        expiresAt: expiresAt.toISOString(),
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    },
    { resolveRecipients: resolvePendingActionEventRecipients },
  );

  let auditFailure = false;
  try {
    await tx.transaction((auditTx) =>
      appendAuditLog(auditTx, {
        actorId: input.actorId,
        actorType: input.actorType,
        apiKeyId:
          input.credentialType === "api_key" ? input.credentialId : null,
        actorIp: input.actorIp,
        userAgent: input.userAgent,
        traceId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        organisationId: scope.organisationId,
        action: "pending_action.requested",
        entityType: "pending_action",
        entityId: id,
        after: {
          action: input.action,
          origin: input.origin,
          targetType: input.targetType,
          targetCount: payload.target_ids.length,
          expiresAt: expiresAt.toISOString(),
        },
      }),
    );
  } catch {
    auditFailure = true;
  }
  return {
    pendingActionId: id,
    action: input.action,
    summary: scope.summary,
    confirmation,
    expiresAt: expiresAt.toISOString(),
    approveUrl: `/agent/settings/profile/pending-actions/${id}`,
    auditFailure,
  };
}

/** Creates the durable approval and its audit record before returning any 202 response. */
export async function createPendingAction(requested: CreatePendingActionInput) {
  // GM-9: an impersonator may not request a deletion (or any other pending action) as the
  // target. Every route that opens one, single or bulk, DELETE or POST, passes through here.
  if (currentImpersonatorId() !== null) {
    throw new HTTPException(403, {
      message:
        "impersonation: requesting a deletion is not allowed during an impersonation session",
    });
  }
  const input = await bindKeyCredentialOrigin(requested);
  assertRegisteredRouteKey(input.routeKey);
  const now = new Date();
  const id = createId();
  const traceId = createId();
  let conflictTargetIds = [...input.targetIds].sort();
  let requestAuditFailure = false;
  let created:
    | {
        confirmation: ConfirmationKind;
        summary: Record<string, unknown>;
        auditFailure: boolean;
      }
    | undefined;

  if (input.targetVersions !== undefined && input.targetVersions !== null) {
    throw new TypeError(
      "Caller-supplied pending-action target versions are not supported",
    );
  }
  if (input.credentialType === "api_key" && !input.credentialId?.trim()) {
    throw new HTTPException(403, {
      message: "API-key pending actions require an authenticated key ID",
    });
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const transact = () =>
        db.transaction(async (tx) => {
          await lockPendingActionLifecycle(tx);
          const scope = await resolveRequestScope(tx, input);
          const executionTargetIds =
            scope.executionTargetIds ?? input.targetIds;
          conflictTargetIds = [...executionTargetIds].sort();
          const confirmation = requiredConfirmation({
            action: input.action,
            targetType: input.targetType,
            targetCount: executionTargetIds.length,
          });
          const payload = canonicalPendingActionPayload({
            action: input.action,
            route_key: input.routeKey,
            target_type: input.targetType,
            target_ids: executionTargetIds,
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            organisation_id: scope.organisationId,
            confirmation_required: confirmation,
            ...(input.mcpDecision ? { mcp_decision: input.mcpDecision } : {}),
          });
          const payloadHash = hashPendingActionPayload(payload);
          const [created] = await tx
            .insert(pendingActionTable)
            .values({
              id,
              requestedByPersonId: input.requesterPersonId,
              credentialType: input.credentialType,
              credentialId: input.credentialId,
              origin: input.origin,
              action: input.action,
              targetType: input.targetType,
              targetIds: payload.target_ids,
              targetVersions: scope.targetVersions ?? null,
              payload,
              routeKey: input.routeKey,
              payloadHash,
              payloadSummary: scope.summary,
              workspaceId: scope.workspaceId,
              projectId: scope.projectId,
              organisationId: scope.organisationId,
              confirmationRequired: confirmation,
              state: "pending",
              createdAt: now,
              expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
              traceId,
            })
            .returning({ id: pendingActionTable.id });

          if (!created)
            throw new Error("Pending action insert returned no row");
          // PA-4: an API-key or MCP request is the key's act, not the person's, and the person
          // is the one notified ("An agent using your key ... asked to delete ..."). Fan-out
          // never notifies a person actor, so the envelope names the key as the actor.
          const keyActor =
            input.credentialType === "api_key" &&
            input.credentialId &&
            (input.origin === "api" || input.origin === "mcp")
              ? await tx
                  .select({ id: apikeyTable.id, name: apikeyTable.name })
                  .from(apikeyTable)
                  .where(eq(apikeyTable.id, input.credentialId))
                  .limit(1)
                  .then(([key]) => key)
              : undefined;
          await enqueueNotificationEvent(
            tx,
            {
              id: `evt_${createId()}`,
              kind: "pending_action.requested",
              occurredAt: now.toISOString(),
              actor: keyActor
                ? {
                    type: "api_key",
                    id: keyActor.id,
                    name: keyActor.name ?? "API key",
                  }
                : {
                    type: "person",
                    id: input.requesterPersonId,
                    name: scope.actorName,
                  },
              scope: pendingActionEventScope({
                action: input.action,
                targetType: input.targetType,
                routeKey: input.routeKey,
                targetIds: executionTargetIds,
                ...scope,
              }),
              payload: {
                key: id,
                url: `/agent/settings/profile/pending-actions/${id}`,
                pendingActionId: id,
                action: input.action,
                origin: input.origin,
                targetType: input.targetType,
                targetCount: payload.target_ids.length,
                expiresAt: new Date(
                  now.getTime() + ACTION_TTL_MS,
                ).toISOString(),
              },
              causationId: null,
              depth: 0,
              originAutomationId: null,
            },
            { resolveRecipients: resolvePendingActionEventRecipients },
          );

          try {
            await tx.transaction(async (auditTx) =>
              appendAuditLog(auditTx, {
                actorId: input.actorId,
                actorType: input.actorType,
                apiKeyId:
                  input.credentialType === "api_key"
                    ? input.credentialId
                    : null,
                actorIp: input.actorIp,
                userAgent: input.userAgent,
                traceId,
                workspaceId: scope.workspaceId,
                projectId: scope.projectId,
                organisationId: scope.organisationId,
                action: "pending_action.requested",
                entityType: "pending_action",
                entityId: id,
                after: {
                  action: input.action,
                  origin: input.origin,
                  targetType: input.targetType,
                  targetCount: payload.target_ids.length,
                  expiresAt: new Date(
                    now.getTime() + ACTION_TTL_MS,
                  ).toISOString(),
                },
              }),
            );
          } catch {
            requestAuditFailure = true;
          }
          return {
            confirmation,
            summary: scope.summary,
            auditFailure: requestAuditFailure,
          };
        });
      created =
        input.action === "delete" &&
        input.targetType === "identity_connection" &&
        input.routeKey === "DELETE /api/instance/identity-connections/{id}"
          ? await retryIdentityGrantClosure(transact)
          : await transact();
      break;
    } catch (error) {
      if (requestAuditFailure) {
        recordAuditWriteFailure("mutation");
        await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
        requestAuditFailure = false;
      }
      if (!isUniqueViolation(error)) throw error;

      const [existing] = await db
        .select({ id: pendingActionTable.id })
        .from(pendingActionTable)
        .where(
          and(
            eq(pendingActionTable.requestedByPersonId, input.requesterPersonId),
            eq(pendingActionTable.action, input.action),
            eq(pendingActionTable.targetIds, conflictTargetIds),
            eq(pendingActionTable.state, "pending"),
          ),
        )
        .limit(1);
      if (existing) {
        throw new HTTPException(409, {
          message: `pending_approval: ${existing.id}`,
        });
      }
      if (attempt === 1) throw error;
    }
  }

  if (!created) throw new Error("Pending action request did not commit");
  if (created.auditFailure) {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }

  let responseSummary = created.summary;
  if (
    input.targetType === "work_item" &&
    (input.action === "delete" || input.action === "bulk_delete")
  ) {
    const [row] = await db
      .select()
      .from(pendingActionTable)
      .where(eq(pendingActionTable.id, id));
    const [requester] = await db
      .select({ userId: personTable.userId })
      .from(personTable)
      .where(eq(personTable.id, input.requesterPersonId));
    const [key] =
      input.credentialType === "api_key" && input.credentialId
        ? await db
            .select()
            .from(apikeyTable)
            .where(eq(apikeyTable.id, input.credentialId))
        : [];
    const viewer = requester?.userId
      ? await resolveIdentity({
          userId: requester.userId,
          ...(input.credentialType === "api_key"
            ? {
                credential: "api_key" as const,
                apiKey: {
                  enabled: key?.enabled === true,
                  ownerUserId: key?.referenceId ?? "",
                  capabilities: apiKeyCapabilitySubset(
                    apiKeyScopeFromStoredPermissions(key?.permissions ?? null),
                  ),
                },
              }
            : { credential: "session" as const }),
        })
      : null;
    responseSummary =
      row && viewer
        ? ((await (input.action === "bulk_delete"
            ? bulkWorkItemDeletionReadSummary
            : workItemDeletionReadSummary)(row, db, viewer)) ?? {
            redacted: true,
            targetCount: 1,
          })
        : { redacted: true, targetCount: 1 };
  }
  return {
    pendingActionId: id,
    action: input.action,
    summary: responseSummary,
    confirmation: created.confirmation,
    expiresAt: new Date(now.getTime() + ACTION_TTL_MS).toISOString(),
    approveUrl: `/agent/settings/profile/pending-actions/${id}`,
  };
}

export async function getOwnPendingActions(
  userId: string,
  options: { cursor?: string; limit: number },
  apiKey: { id: string; userId: string; enabled: boolean } | undefined,
  auditContext: { apiKeyId: string | null; traceId: string },
) {
  const identity = await resolveIdentity({
    userId,
    credential: apiKey ? "api_key" : "session",
    apiKey: apiKey
      ? { enabled: apiKey.enabled, ownerUserId: apiKey.userId }
      : undefined,
  });
  if (!identity) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  const conditions = [
    eq(pendingActionTable.requestedByPersonId, identity.personId),
    eq(pendingActionTable.state, "pending"),
  ];
  if (options.cursor !== undefined) {
    const cursor = decodePendingActionCursor(options.cursor);
    const cursorCondition = or(
      lt(pendingActionTable.createdAt, cursor.createdAt),
      and(
        eq(pendingActionTable.createdAt, cursor.createdAt),
        lt(pendingActionTable.id, cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await db
    .select({
      pendingAction: pendingActionTable,
      requestingKeyName: apikeyTable.name,
    })
    .from(pendingActionTable)
    .leftJoin(
      apikeyTable,
      and(
        eq(apikeyTable.id, pendingActionTable.credentialId),
        eq(apikeyTable.referenceId, userId),
        eq(pendingActionTable.credentialType, "api_key"),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(pendingActionTable.createdAt), desc(pendingActionTable.id))
    .limit(options.limit + 1);

  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.requestedByPersonId, identity.personId),
        eq(pendingActionTable.state, "pending"),
      ),
    );

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const data = await Promise.all(
    pageRows.map(({ pendingAction, requestingKeyName }) =>
      toPendingActionRead(pendingAction, requestingKeyName, identity),
    ),
  );
  for (const { pendingAction } of pageRows) {
    await auditViewed(
      pendingAction.id,
      pendingAction,
      identity.personId,
      auditContext,
    );
  }
  const lastRow = pageRows.at(-1)?.pendingAction;

  return {
    data,
    page: {
      nextCursor:
        hasMore && lastRow
          ? encodePendingActionCursor(lastRow.createdAt, lastRow.id)
          : null,
      hasMore,
    },
    meta: { total: count?.total ?? 0 },
  };
}

export async function getOwnPendingAction(
  userId: string,
  id: string,
  apiKey: { id: string; userId: string; enabled: boolean } | undefined,
  auditContext: { apiKeyId: string | null; traceId: string },
) {
  const identity = await resolveIdentity({
    userId,
    credential: apiKey ? "api_key" : "session",
    apiKey: apiKey
      ? { enabled: apiKey.enabled, ownerUserId: apiKey.userId }
      : undefined,
  });
  if (!identity) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  const [result] = await db
    .select({
      pendingAction: pendingActionTable,
      requestingKeyName: apikeyTable.name,
    })
    .from(pendingActionTable)
    .leftJoin(
      apikeyTable,
      and(
        eq(apikeyTable.id, pendingActionTable.credentialId),
        eq(apikeyTable.referenceId, userId),
        eq(pendingActionTable.credentialType, "api_key"),
      ),
    )
    .where(
      and(
        eq(pendingActionTable.id, id),
        eq(pendingActionTable.requestedByPersonId, identity.personId),
      ),
    )
    .limit(1);
  if (!result)
    throw new HTTPException(404, { message: "Pending action not found" });
  const data = await toPendingActionRead(
    result.pendingAction,
    result.requestingKeyName,
    identity,
    true,
  );
  await auditViewed(
    result.pendingAction.id,
    result.pendingAction,
    identity.personId,
    auditContext,
  );
  return data;
}

export async function requirePendingActionRequesterIdentity(
  userId: string,
  apiKey: { id: string; userId: string; enabled: boolean } | undefined,
) {
  // PA-5a: refuse a workspace service key before identity resolution can turn "no person"
  // into a generic 401.
  if (apiKey) assertKeyHasApprover(await loadApiKeyKind(apiKey.id));
  const identity = await resolveIdentity({
    userId,
    credential: apiKey ? "api_key" : "session",
    apiKey: apiKey
      ? { enabled: apiKey.enabled, ownerUserId: apiKey.userId }
      : undefined,
  });
  if (!identity) {
    throw new HTTPException(401, { message: "Authentication required" });
  }
  return identity.personId;
}

export async function decideOwnPendingAction(input: {
  id: string;
  requesterPersonId: string;
  outcome: "denied" | "cancelled";
  sessionId?: string | null;
}) {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    const [row] = await tx
      .select()
      .from(pendingActionTable)
      .where(
        and(
          eq(pendingActionTable.id, input.id),
          eq(pendingActionTable.requestedByPersonId, input.requesterPersonId),
        ),
      )
      .for("update")
      .limit(1);
    if (!row)
      throw new HTTPException(404, { message: "Pending action not found" });
    if (row.state !== "pending") {
      throw new HTTPException(409, { message: "pending_action_not_pending" });
    }
    const outcome = row.expiresAt <= now ? "expired" : input.outcome;
    const legacyInstanceUserDeactivation =
      isLegacyInstanceUserDeactivation(row);
    const instanceOrganisationDeletion =
      row.action === "delete" &&
      row.targetType === "organisation" &&
      row.routeKey === "DELETE /api/instance/organisations/{id}" &&
      row.targetIds.length === 1 &&
      row.workspaceId === null &&
      row.projectId === null &&
      row.organisationId === row.targetIds[0];
    const [actor] = await tx
      .select({
        userId: personTable.userId,
        name: userTable.name,
      })
      .from(personTable)
      .innerJoin(userTable, eq(userTable.id, personTable.userId))
      .where(eq(personTable.id, input.requesterPersonId))
      .limit(1);
    if (
      !actor?.userId ||
      (!row.workspaceId &&
        !(
          row.action === "delete" &&
          row.targetType === "user" &&
          row.routeKey === "POST /api/instance/users/{id}/deactivate"
        ) &&
        !legacyInstanceUserDeactivation &&
        !instanceOrganisationDeletion &&
        !(
          row.action === "delete" &&
          row.targetType === "identity_connection" &&
          row.routeKey === "DELETE /api/instance/identity-connections/{id}" &&
          row.targetIds.length === 1 &&
          row.workspaceId === null &&
          row.projectId === null &&
          row.organisationId === null
        ))
    ) {
      throw new HTTPException(403, {
        message: "Pending-action requester is unavailable",
      });
    }
    // Resolve and validate legacy identities before changing state or emitting audit/outbox.
    const publicFields = await publicPendingActionFields(row, tx);
    const [updated] = await tx
      .update(pendingActionTable)
      .set({
        state: outcome,
        decidedByPersonId: input.requesterPersonId,
        decisionSessionId: input.sessionId ?? null,
        decidedAt: now,
      })
      .where(
        and(
          eq(pendingActionTable.id, input.id),
          eq(pendingActionTable.state, "pending"),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, { message: "pending_action_not_pending" });

    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "pending_action.decided",
      occurredAt: now.toISOString(),
      actor: {
        type: "person",
        id: input.requesterPersonId,
        name: actor.name,
      },
      scope: pendingActionEventScope(row),
      payload: {
        key: row.id,
        url: `/agent/settings/profile/pending-actions/${row.id}`,
        pendingActionId: row.id,
        outcome,
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    let auditFailure = false;
    try {
      await tx.transaction(async (auditTx) =>
        appendAuditLog(auditTx, {
          actorId: input.requesterPersonId,
          actorType: "person",
          traceId: row.traceId,
          workspaceId: row.workspaceId,
          projectId: row.projectId,
          organisationId: row.organisationId,
          action: "pending_action.decided",
          entityType: "pending_action",
          entityId: row.id,
          before: { state: "pending" },
          after: { state: outcome },
        }),
      );
    } catch {
      auditFailure = true;
    }
    return { updated, auditFailure, publicFields };
  });

  if (result.auditFailure) {
    recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }

  return toPublicPendingAction(result.updated, result.publicFields);
}

export async function approveUserDeactivation(input: {
  id: string;
  requesterPersonId: string;
  userId: string;
  sessionId: string;
  typedName: string;
  stepUpToken: string;
  traceId: string;
}) {
  const result = await retryIdentityGrantClosure(() =>
    db.transaction(async (tx) => {
      // Shared instance-admin serialization first, as in grant-admin and suspend, so the
      // last-administrator guard and every admin-reducing mutation are one ordered step.
      await lockInstanceAdminSerialization(tx);
      await lockPendingActionLifecycle(tx);
      const now = new Date();
      let auditFailures = 0;
      const [row] = await tx
        .select()
        .from(pendingActionTable)
        .where(
          and(
            eq(pendingActionTable.id, input.id),
            eq(pendingActionTable.requestedByPersonId, input.requesterPersonId),
          ),
        )
        .for("update")
        .limit(1);
      if (!row)
        throw new HTTPException(404, { message: "Pending action not found" });
      if (row.state !== "pending")
        throw new HTTPException(409, { message: "pending_action_not_pending" });
      if (
        row.action !== "delete" ||
        row.targetType !== "user" ||
        row.routeKey !== "POST /api/instance/users/{id}/deactivate"
      )
        throw new HTTPException(409, {
          message: "pending_action_kind_unsupported",
        });
      if (row.expiresAt <= now) {
        const [expiredBy] = await tx
          .select({ name: userTable.name })
          .from(personTable)
          .innerJoin(userTable, eq(userTable.id, personTable.userId))
          .where(eq(personTable.id, input.requesterPersonId))
          .limit(1);
        const [expired] = await tx
          .update(pendingActionTable)
          .set({
            state: "expired",
            decidedByPersonId: input.requesterPersonId,
            decisionSessionId: input.sessionId,
            decidedAt: now,
          })
          .where(
            and(
              eq(pendingActionTable.id, row.id),
              eq(pendingActionTable.state, "pending"),
            ),
          )
          .returning();
        if (!expired)
          throw new HTTPException(409, {
            message: "pending_action_not_pending",
          });
        await writeUserDeactivationTransition(tx, {
          row,
          actorPersonId: input.requesterPersonId,
          actorName: expiredBy?.name ?? "Unknown user",
          traceId: input.traceId,
          state: "expired",
          occurredAt: now,
        });
        return { row: expired, state: "expired" as const, auditFailures: 0 };
      }
      const route = policyRegistry.get(row.routeKey);
      if (
        row.routeKey !== "POST /api/instance/users/{id}/deactivate" ||
        route?.kind !== "capability" ||
        !("capability" in route.policy) ||
        route.policy.scope !== "instance" ||
        route.policy.capability !== "instance:admin"
      ) {
        throw new HTTPException(409, {
          message: "pending_action_policy_changed",
        });
      }
      let payload: ReturnType<typeof canonicalPendingActionPayload>;
      try {
        payload = canonicalPendingActionPayload(
          row.payload as Parameters<typeof canonicalPendingActionPayload>[0],
        );
      } catch {
        throw new HTTPException(409, {
          message: "pending_action_payload_invalid",
        });
      }
      if (
        hashPendingActionPayload(payload) !== row.payloadHash ||
        payload.action !== "delete" ||
        payload.route_key !== row.routeKey ||
        payload.target_type !== "user" ||
        payload.target_ids.length !== 1 ||
        payload.target_ids[0] !== row.targetIds[0] ||
        payload.confirmation_required !== "typed_name_step_up" ||
        payload.workspace_id !== null ||
        payload.project_id !== null ||
        payload.organisation_id !== null ||
        row.confirmationRequired !== "typed_name_step_up"
      ) {
        throw new HTTPException(409, {
          message: "pending_action_payload_invalid",
        });
      }
      const userId = payload.target_ids[0];
      if (!userId)
        throw new HTTPException(409, {
          message: "pending_action_target_invalid",
        });
      const [targetCandidate] = await tx
        .select({ id: personTable.id })
        .from(personTable)
        .innerJoin(userTable, eq(userTable.id, personTable.userId))
        .where(eq(userTable.id, userId))
        .limit(1);
      const closure = await lockPersonLifecycleClosureInTransaction(
        tx,
        [
          input.requesterPersonId,
          ...(targetCandidate ? [targetCandidate.id] : []),
        ],
        { kind: "administrative" },
      );
      const [actor] = await tx
        .select({
          personId: personTable.id,
          userId: personTable.userId,
          active: personTable.active,
          side: personTable.side,
          role: userTable.role,
          banned: userTable.banned,
          name: userTable.name,
        })
        .from(personTable)
        .innerJoin(userTable, eq(userTable.id, personTable.userId))
        .where(eq(personTable.id, input.requesterPersonId))
        .for("update", { of: userTable })
        .limit(1);
      const [session] = await tx
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(
          and(
            eq(schema.sessionTable.id, input.sessionId),
            eq(schema.sessionTable.userId, input.userId),
            eq(schema.sessionTable.portal, "agent"),
            gt(schema.sessionTable.expiresAt, dbNowUtc()),
          ),
        )
        .for("update")
        .limit(1);
      if (!session) {
        throw new HTTPException(403, { message: "Forbidden" });
      }
      if (
        !actor?.userId ||
        actor.userId !== input.userId ||
        actor.active !== true ||
        actor.side !== "staff" ||
        actor.banned ||
        actor.role !== "admin"
      ) {
        const invalidated = await invalidateUserDeactivation(tx, {
          row,
          actorPersonId: input.requesterPersonId,
          actorName: actor?.name ?? "TaskDesk",
          traceId: input.traceId,
          reason: "capability_removed",
          now,
          sessionId: input.sessionId,
        });
        return {
          row: invalidated,
          state: "invalidated" as const,
          auditFailures: 0,
        };
      }
      const [target] = await tx
        .select({
          id: personTable.id,
          userId: personTable.userId,
          targetUserId: userTable.id,
          active: personTable.active,
          organisationId: personTable.organisationId,
          email: userTable.email,
          name: userTable.name,
          role: userTable.role,
        })
        .from(personTable)
        .innerJoin(userTable, eq(userTable.id, personTable.userId))
        .where(eq(userTable.id, userId))
        .for("update", { of: userTable })
        .limit(1);
      if (target?.id !== targetCandidate?.id)
        throw new IdentityGrantClosureChangedError();
      if (!target?.userId || target.targetUserId !== userId || !target.active) {
        const invalidated = await invalidateUserDeactivation(tx, {
          row,
          actorPersonId: input.requesterPersonId,
          actorName: actor.name,
          traceId: input.traceId,
          reason: "version_changed",
          now,
          sessionId: input.sessionId,
        });
        return {
          row: invalidated,
          state: "invalidated" as const,
          auditFailures: 0,
        };
      }
      const summary = row.payloadSummary as { email?: unknown };
      if (summary.email !== target.email) {
        const invalidated = await invalidateUserDeactivation(tx, {
          row,
          actorPersonId: input.requesterPersonId,
          actorName: actor.name,
          traceId: input.traceId,
          reason: "version_changed",
          now,
          sessionId: input.sessionId,
        });
        return {
          row: invalidated,
          state: "invalidated" as const,
          auditFailures: 0,
        };
      }
      await assertAdminRemovalAllowed(tx, {
        actorUserId: input.userId,
        targetUserId: userId,
        targetRole: target.role,
      });
      if (input.typedName !== target.email)
        throw new HTTPException(400, { message: "confirmation_mismatch" });
      const proof = await consumePendingActionProof(tx, {
        token: input.stepUpToken,
        personId: input.requesterPersonId,
        sessionId: input.sessionId,
        userId: input.userId,
        pendingActionId: row.id,
      });
      if (!proof) {
        await appendPendingActionStepUpAudit(tx, {
          action: "auth.step_up_denied",
          actorId: input.userId,
          personId: input.requesterPersonId,
          pendingActionId: row.id,
          traceId: input.traceId,
        });
        return { row, state: "denied" as const, auditFailures: 0 };
      }
      await appendPendingActionStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: input.userId,
        personId: input.requesterPersonId,
        pendingActionId: row.id,
        traceId: input.traceId,
      });
      // PA-6 step 5: only the execution step itself can produce a `failed` outcome; the
      // grant-closure retry signal and the conflicts `retryIdentityGrantClosure` retries
      // keep their retry meaning.
      const lifecycle = await failOnExecutorError(
        () =>
          transitionPersonLifecycleInTransaction(
            tx,
            target.id,
            false,
            "end_memberships",
            { kind: "administrative" },
            closure,
          ),
        {
          passthrough: (error) =>
            error instanceof IdentityGrantClosureChangedError ||
            RETRIED_GRANT_CLOSURE_CONFLICTS.has(databaseErrorCode(error) ?? ""),
        },
      )();
      if (!lifecycle)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      auditFailures += lifecycle.pendingActionAuditFailures;
      const [executed] = await tx
        .update(pendingActionTable)
        .set({
          state: "executed",
          confirmationSupplied: { typedNameMatched: true, stepUp: true },
          stepUpTokenId: proof.id,
          decidedByPersonId: input.requesterPersonId,
          decisionSessionId: input.sessionId,
          decidedAt: now,
          executedAt: now,
        })
        .where(
          and(
            eq(pendingActionTable.id, row.id),
            eq(pendingActionTable.state, "pending"),
          ),
        )
        .returning();
      if (!executed)
        throw new HTTPException(409, { message: "pending_action_not_pending" });
      const scope = {};
      const occurredAt = now.toISOString();
      for (const [kind, payload] of [
        [
          "pending_action.decided",
          {
            key: row.id,
            url: `/agent/settings/profile/pending-actions/${row.id}`,
            pendingActionId: row.id,
            outcome: "approved",
          },
        ],
        [
          "pending_action.executed",
          {
            pendingActionId: row.id,
            action: row.action,
            targetIds: row.targetIds,
            outcome: "executed",
          },
        ],
        [
          "identity.deprovisioned",
          {
            source: "god_mode",
            personId: target.id,
            organisationId: target.organisationId,
            externalIdentityIds: lifecycle.externalIdentityIds,
            previousState: { active: true },
            resultingAction: "deactivated",
            sessionsRevoked: lifecycle.sessionsRevoked,
            keysRevoked: lifecycle.keysRevoked,
            membershipsEnded: lifecycle.membershipsEnded,
          },
        ],
      ] as const) {
        await enqueueOutboxEvent(tx, {
          id: `evt_${createId()}`,
          kind,
          occurredAt,
          actor: {
            type: "person",
            id: input.requesterPersonId,
            name: actor.name,
          },
          scope,
          payload,
          causationId: null,
          depth: 0,
          originAutomationId: null,
        });
      }
      const audits: Array<{
        action: string;
        entityType: string;
        entityId: string;
        before: JsonValue | null;
        after: JsonValue;
      }> = [
        {
          action: "pending_action.decided",
          entityType: "pending_action",
          entityId: row.id,
          before: { state: "pending" },
          after: { outcome: "approved" },
        },
        {
          action: "pending_action.executed",
          entityType: "pending_action",
          entityId: row.id,
          before: null,
          after: {
            outcome: "executed",
            action: row.action,
            targetCount: row.targetIds.length,
          },
        },
        {
          action: "identity.deprovisioned",
          entityType: "person",
          entityId: target.id,
          before: null,
          after: {
            source: "god_mode",
            sessionsRevoked: lifecycle.sessionsRevoked,
            keysRevoked: lifecycle.keysRevoked,
            membershipsEnded: lifecycle.membershipsEnded,
          },
        },
      ];
      for (const audit of audits) {
        try {
          await tx.transaction(async (auditTx) =>
            appendAuditLog(auditTx, {
              actorId: input.requesterPersonId,
              actorType: "person",
              traceId: input.traceId,
              workspaceId: null,
              action: audit.action,
              entityType: audit.entityType,
              entityId: audit.entityId,
              before: audit.before,
              after: audit.after,
            }),
          );
        } catch {
          auditFailures += 1;
        }
      }
      return { row: executed, state: "executed" as const, auditFailures };
    }),
  );
  if (result.state === "invalidated") {
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  }
  if (result.state === "denied") {
    throw new HTTPException(403, { message: "step_up_expired" });
  }
  if (result.state === "executed") {
    const [targetUserId] = result.row.targetIds;
    if (targetUserId)
      await invalidateNativeAuthorization({ userId: targetUserId });
  }
  if (result.auditFailures > 0) {
    for (let index = 0; index < result.auditFailures; index += 1)
      recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }
  return toPublicPendingAction(result.row);
}

async function invalidateUserDeactivation(
  tx: PendingActionTransaction,
  input: {
    row: typeof pendingActionTable.$inferSelect;
    actorPersonId: string;
    actorName: string;
    traceId: string;
    reason: "capability_removed" | "version_changed";
    now: Date;
    sessionId: string;
  },
) {
  const [updated] = await tx
    .update(pendingActionTable)
    .set({
      state: "invalidated",
      invalidationReason: input.reason,
      decidedByPersonId: input.actorPersonId,
      decisionSessionId: input.sessionId,
      decidedAt: input.now,
    })
    .where(
      and(
        eq(pendingActionTable.id, input.row.id),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .returning();
  if (!updated)
    throw new HTTPException(409, { message: "pending_action_not_pending" });
  await writeUserDeactivationTransition(tx, {
    row: input.row,
    actorPersonId: input.actorPersonId,
    actorName: input.actorName,
    traceId: input.traceId,
    state: "invalidated",
    invalidationReason: input.reason,
    occurredAt: input.now,
  });
  return updated;
}

async function writeUserDeactivationTransition(
  tx: PendingActionTransaction,
  input: {
    row: typeof pendingActionTable.$inferSelect;
    actorPersonId: string;
    actorName: string;
    traceId: string;
    state: "expired" | "invalidated";
    invalidationReason?: "capability_removed" | "version_changed";
    occurredAt?: Date;
  },
) {
  const scope = {};
  await enqueueOutboxEvent(tx, {
    id: `evt_${createId()}`,
    kind: "pending_action.decided",
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    actor: { type: "person", id: input.actorPersonId, name: input.actorName },
    scope,
    payload: {
      key: input.row.id,
      url: `/agent/settings/profile/pending-actions/${input.row.id}`,
      pendingActionId: input.row.id,
      outcome: input.state,
      ...(input.invalidationReason
        ? { invalidationReason: input.invalidationReason }
        : {}),
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  try {
    await tx.transaction(async (auditTx) =>
      appendAuditLog(auditTx, {
        actorId: input.actorPersonId,
        actorType: "person",
        traceId: input.traceId,
        workspaceId: null,
        action: "pending_action.decided",
        entityType: "pending_action",
        entityId: input.row.id,
        before: { state: "pending" },
        after: {
          state: input.state,
          ...(input.invalidationReason
            ? { invalidationReason: input.invalidationReason }
            : {}),
        },
      }),
    );
  } catch {
    recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }
}

async function auditViewed(
  id: string,
  row: typeof pendingActionTable.$inferSelect,
  actorId: string,
  auditContext: { apiKeyId: string | null; traceId: string },
) {
  try {
    await appendAuditLog(db, {
      actorId,
      actorType: auditContext.apiKeyId === null ? "person" : "api_key",
      apiKeyId: auditContext.apiKeyId,
      traceId: auditContext.traceId,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      organisationId: row.organisationId,
      action: "pending_action.viewed",
      entityType: "pending_action",
      entityId: id,
      after: { rendered: true },
    });
  } catch {
    recordAuditWriteFailure("pending_action_self_read");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_self_read");
    throw new HTTPException(500, { message: "Audit log unavailable" });
  }
}

type PendingActionCursor = {
  createdAt: Date;
  id: string;
};

function encodePendingActionCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ v: 1, createdAt: createdAt.toISOString(), id }),
    "utf8",
  ).toString("base64url");
}

function decodePendingActionCursor(value: string): PendingActionCursor {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  if (typeof candidate !== "object" || candidate === null) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  const payload = candidate as Record<string, unknown>;
  const createdAtValue = payload.createdAt;
  const id = payload.id;
  if (
    Object.keys(payload).length !== 3 ||
    payload.v !== 1 ||
    typeof createdAtValue !== "string" ||
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 64 ||
    id.includes("\u0000")
  ) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }

  const createdAt = new Date(createdAtValue);
  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt.toISOString() !== createdAtValue
  ) {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
  return { createdAt, id };
}

async function toPendingActionRead(
  row: typeof pendingActionTable.$inferSelect,
  requestingKeyName: string | null,
  viewer: ResolvedIdentity,
  includeTargetWorkspaceId = false,
) {
  const publicFields = await publicPendingActionFields(row, db, viewer);
  const hasValidatedWorkspaceSummary =
    (row.action === "delete" &&
      row.targetType === "work_item" &&
      row.routeKey === WORK_ITEM_DELETION_ROUTE) ||
    (row.action === "bulk_delete" &&
      row.targetType === "work_item" &&
      row.routeKey === BULK_WORK_ITEM_DELETION_ROUTE) ||
    (row.action === "delete" &&
      row.targetType === "comment" &&
      row.routeKey === COMMENT_DELETION_ROUTE) ||
    (row.action === "delete" &&
      row.targetType === "attachment" &&
      row.routeKey === ATTACHMENT_DELETION_ROUTE) ||
    (row.action === "delete" &&
      row.targetType === "relation" &&
      row.routeKey === RELATION_DELETION_ROUTE);
  const targetWorkspaceId =
    includeTargetWorkspaceId &&
    row.workspaceId !== null &&
    publicFields.approvalSupported &&
    publicFields.summary.redacted !== true
      ? hasValidatedWorkspaceSummary
        ? row.workspaceId
        : await readPendingActionTargetWorkspace(row, viewer)
      : null;
  return pendingActionReadSchema.parse({
    id: row.id,
    action: publicFields.action,
    origin: row.origin,
    targetType: publicFields.targetType,
    targetIds: publicFields.targetIds,
    targetWorkspaceId,
    summary: publicFields.summary,
    confirmation: row.confirmationRequired,
    approvalSupported: publicFields.approvalSupported,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    invalidationReason: row.invalidationReason,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    requestingKeyName,
  });
}

export type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type PublicPendingActionFields = {
  action: "delete" | "bulk_delete" | "purge" | "mcp_destructive";
  targetType: string;
  targetIds: string[];
  summary: Record<string, unknown>;
  approvalSupported: boolean;
};

function isLegacyInstanceUserDeactivation(
  row: typeof pendingActionTable.$inferSelect,
): boolean {
  return (
    row.action === "user_deactivation" &&
    row.targetType === "person" &&
    row.routeKey === "POST /api/instance/users/{id}/deactivate" &&
    row.workspaceId === null &&
    row.projectId === null &&
    row.organisationId === null
  );
}

async function publicPendingActionFields(
  row: typeof pendingActionTable.$inferSelect,
  executor: typeof db | PendingActionTransaction = db,
  viewer?: ResolvedIdentity,
): Promise<PublicPendingActionFields> {
  if (
    row.action === "delete" &&
    row.targetType === "attachment" &&
    row.routeKey === ATTACHMENT_DELETION_ROUTE
  ) {
    const summary = await attachmentDeletionReadSummary(row, executor, viewer);
    return {
      action: "delete",
      targetType: "attachment",
      targetIds: summary ? row.targetIds : [],
      summary: summary ?? { redacted: true, targetCount: 1 },
      approvalSupported: summary !== undefined,
    };
  }

  if (
    row.action === "delete" &&
    row.targetType === "comment" &&
    row.routeKey === COMMENT_DELETION_ROUTE
  ) {
    const summary = await commentDeletionReadSummary(row, executor, viewer);
    return {
      action: "delete",
      targetType: "comment",
      targetIds: summary ? row.targetIds : [],
      summary: summary ?? { redacted: true, targetCount: 1 },
      approvalSupported: summary !== undefined,
    };
  }

  if (
    row.targetType === "work_item" &&
    ((row.action === "delete" && row.routeKey === WORK_ITEM_DELETION_ROUTE) ||
      (row.action === "bulk_delete" &&
        row.routeKey === BULK_WORK_ITEM_DELETION_ROUTE))
  ) {
    const summary = await (row.action === "bulk_delete"
      ? bulkWorkItemDeletionReadSummary
      : workItemDeletionReadSummary)(row, executor, viewer);
    return {
      action: row.action === "bulk_delete" ? "bulk_delete" : "delete",
      targetType: "work_item",
      targetIds: summary ? row.targetIds : [],
      summary: summary ?? { redacted: true, targetCount: row.targetIds.length },
      approvalSupported:
        summary !== undefined &&
        resolvePendingActionApprovalContract({
          action: row.action,
          targetType: row.targetType,
          confirmationRequired: row.confirmationRequired,
          routeKey: row.routeKey,
        }) !== undefined,
    };
  }
  if (
    row.action === "delete" &&
    row.targetType === "relation" &&
    row.routeKey === RELATION_DELETION_ROUTE
  ) {
    const summary = await relationDeletionReadSummary(row, executor, viewer);
    return {
      action: "delete",
      targetType: "relation",
      targetIds: row.targetIds,
      summary: summary ?? { redacted: true, targetCount: 1 },
      approvalSupported:
        summary !== undefined &&
        resolvePendingActionApprovalContract({
          action: row.action,
          targetType: row.targetType,
          confirmationRequired: row.confirmationRequired,
          routeKey: row.routeKey,
        }) !== undefined,
    };
  }
  if (
    row.action === "delete" ||
    row.action === "bulk_delete" ||
    row.action === "purge" ||
    row.action === "mcp_destructive"
  ) {
    return {
      action: row.action,
      targetType: row.targetType,
      targetIds: row.targetIds,
      summary: row.payloadSummary as Record<string, unknown>,
      approvalSupported:
        resolvePendingActionApprovalContract({
          action: row.action,
          targetType: row.targetType,
          confirmationRequired: row.confirmationRequired,
          routeKey: row.routeKey,
        }) !== undefined,
    };
  }
  if (row.action !== "user_deactivation") {
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  }

  const payload = row.payload as Record<string, unknown>;
  const summary = row.payloadSummary as Record<string, unknown>;
  const personId = row.targetIds.length === 1 ? row.targetIds[0] : undefined;
  if (
    !isLegacyInstanceUserDeactivation(row) ||
    row.credentialType !== "session" ||
    row.origin !== "web" ||
    !personId ||
    payload.action !== "user_deactivation" ||
    payload.route_key !== row.routeKey ||
    payload.target_type !== "person" ||
    !Array.isArray(payload.target_ids) ||
    payload.target_ids.length !== 1 ||
    payload.target_ids[0] !== personId ||
    payload.workspace_id !== null ||
    payload.project_id !== null ||
    payload.organisation_id !== null ||
    payload.confirmation_required !== row.confirmationRequired ||
    summary.personId !== personId
  ) {
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  }

  const [target] = await executor
    .select({ userId: personTable.userId })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, personId))
    .limit(1);
  if (
    !target?.userId ||
    (summary.userId !== undefined && summary.userId !== target.userId)
  ) {
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  }

  return {
    action: "delete",
    targetType: "user",
    targetIds: [target.userId],
    summary: { ...summary, userId: target.userId },
    approvalSupported: false,
  };
}

type ResolvedRequestScope = {
  executionTargetIds?: readonly string[];
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
  actorName: string;
  summary: Record<string, unknown>;
  targetVersions?: Record<string, unknown> | null;
  confirmationRequired?: ConfirmationKind;
};

/**
 * Resolve scope from locked rows and evaluate each accepted target's current route policy.
 * Unsupported target/action/route combinations remain refused.
 */
async function resolveRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  if (
    input.action === "mcp_destructive" &&
    input.targetType === "approval_decision" &&
    input.routeKey === MCP_APPROVAL_DECISION_ROUTE &&
    input.targetIds.length === 1
  )
    return resolveMcpApprovalDecisionRequestScope(tx, input);

  if (
    input.action === "mcp_destructive" &&
    input.targetType === "import_chunk" &&
    (input.routeKey === "POST /api/imports/{id}/records" ||
      input.routeKey === "POST /api/imports/{id}/links") &&
    input.targetIds.length === 1 &&
    input.importChunk
  )
    return resolveImportChunkRequestScope(tx, input);

  if (
    input.action === "mcp_destructive" &&
    input.targetType === "import_run" &&
    input.routeKey === "POST /api/imports/{id}/execute" &&
    input.targetIds.length === 1 &&
    input.importRun
  )
    return resolveImportRunRequestScope(tx, input);

  if (
    input.action === "purge" &&
    input.routeKey === "POST /api/instance/purge" &&
    input.targetIds.length === 1
  )
    return resolveHardPurgeRequestScope(tx, input);

  if (
    input.action === "delete" &&
    input.targetType === "attachment" &&
    input.routeKey === ATTACHMENT_DELETION_ROUTE &&
    input.targetIds.length === 1
  )
    return resolveAttachmentDeletionRequestScope(tx, input);

  if (
    input.action === "delete" &&
    input.targetType === "comment" &&
    input.routeKey === COMMENT_DELETION_ROUTE &&
    input.targetIds.length === 1
  )
    return resolveCommentDeletionRequestScope(tx, input);

  if (
    input.action === "bulk_delete" &&
    input.targetType === "work_item" &&
    input.routeKey === BULK_WORK_ITEM_DELETION_ROUTE
  )
    return resolveBulkWorkItemDeletionRequestScope(tx, input);
  if (
    input.action === "delete" &&
    input.targetType === "relation" &&
    input.routeKey === RELATION_DELETION_ROUTE &&
    input.targetIds.length === 1
  )
    return resolveRelationDeletionRequestScope(tx, input);
  if (
    input.action === "delete" &&
    input.targetType === "user" &&
    input.routeKey === "POST /api/instance/users/{id}/deactivate" &&
    input.targetIds.length === 1
  ) {
    return resolveUserDeactivationScope(tx, input);
  }
  if (
    input.action === "delete" &&
    input.targetIds.length === 1 &&
    ((input.targetType === "service_calendar" &&
      input.routeKey === "DELETE /api/service-calendars/{id}") ||
      (input.targetType === "saved_view" &&
        input.routeKey === "DELETE /api/views/{id}"))
  ) {
    return resolveWorkspaceDeletionRequestScope(tx, input);
  }
  if (
    input.action === "delete" &&
    input.targetType === "work_item" &&
    input.routeKey === WORK_ITEM_DELETION_ROUTE &&
    input.targetIds.length === 1
  )
    return resolveWorkItemDeletionRequestScope(tx, input);
  if (isRegisteredDeletion(input) && input.targetIds.length === 1)
    return resolveRegisteredDeletionRequestScope(tx, input);
  throw new HTTPException(400, {
    message: "Pending action target/action/route is unsupported",
  });
}

async function resolveImportChunkRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  const binding = input.importChunk;
  const chunkId = input.targetIds[0];
  if (
    !binding ||
    (input.routeKey !== "POST /api/imports/{id}/records" &&
      input.routeKey !== "POST /api/imports/{id}/links") ||
    (binding.operation === "records" &&
      input.routeKey !== "POST /api/imports/{id}/records") ||
    (binding.operation === "links" &&
      input.routeKey !== "POST /api/imports/{id}/links") ||
    !chunkId ||
    binding.chunkId !== chunkId ||
    !/^[a-f0-9]{64}$/u.test(binding.digest) ||
    !Number.isSafeInteger(binding.expectedRunVersion) ||
    !Number.isSafeInteger(binding.recordCount) ||
    binding.recordCount <= 50 ||
    binding.recordCount > 500
  )
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  const [run] = await tx
    .select()
    .from(schema.importRunTable)
    .where(eq(schema.importRunTable.id, binding.runId))
    .for("update")
    .limit(1);
  if (!run?.projectId)
    throw new HTTPException(404, { message: "Import chunk not found" });
  const [chunk] = await tx
    .select()
    .from(schema.importChunkTable)
    .where(
      and(
        eq(schema.importChunkTable.importRunId, run.id),
        eq(schema.importChunkTable.chunkId, chunkId),
      ),
    )
    .for("update")
    .limit(1);
  if (
    !chunk ||
    chunk.state !== "previewed" ||
    chunk.inputDigest !== binding.digest ||
    chunk.recordCount !== binding.recordCount ||
    chunk.expectedRunVersion !== binding.expectedRunVersion ||
    run.version !== binding.expectedRunVersion ||
    chunk.report.operation !== binding.operation ||
    run.state !== "running"
  )
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  const [project] = await tx
    .select({ organisationId: schema.projectTable.organisationId })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, run.projectId),
        eq(schema.projectTable.workspaceId, run.workspaceId),
        isNull(schema.projectTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!project)
    throw new HTTPException(404, { message: "Import chunk not found" });
  const [requester] = await tx
    .select({
      userId: personTable.userId,
      name: userTable.name,
      active: personTable.active,
      side: personTable.side,
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, input.requesterPersonId))
    .limit(1);
  if (
    !requester?.active ||
    requester.side !== "staff" ||
    requester.userId !== input.actorId
  )
    throw new HTTPException(403, { message: "Forbidden" });

  return {
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    organisationId: project.organisationId,
    actorName: requester.name,
    summary: {
      kind: "mcp_import_chunk",
      operation: binding.operation,
      recordCount: chunk.recordCount,
      pluginId: "import.mcp",
    },
    targetVersions: {
      [chunkId]: {
        runId: run.id,
        digest: chunk.inputDigest,
        expectedRunVersion: run.version + 1,
        recordCount: chunk.recordCount,
        operation: binding.operation,
      },
    },
    confirmationRequired: "typed_count_step_up",
  };
}

async function resolveImportRunRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  const binding = input.importRun;
  const runId = input.targetIds[0];
  if (
    !binding ||
    !runId ||
    binding.runId !== runId ||
    !/^[a-f0-9]{64}$/u.test(binding.digest) ||
    !Number.isSafeInteger(binding.totalCount) ||
    binding.totalCount < 1 ||
    !Number.isSafeInteger(binding.mappingVersion) ||
    binding.mappingVersion < 1 ||
    !Number.isSafeInteger(binding.writes) ||
    binding.writes <= 50 ||
    binding.writes > binding.totalCount
  )
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  const [run] = await tx
    .select()
    .from(schema.importRunTable)
    .where(eq(schema.importRunTable.id, runId))
    .for("update")
    .limit(1);
  if (!run?.projectId || !run.sourceConnectionId)
    throw new HTTPException(404, { message: "Import run not found" });
  const report = run.engineDryRunReport as {
    counts?: { processed?: number; created?: number; updated?: number };
  } | null;
  if (
    (run.state !== "queued" && run.state !== "paused") ||
    run.enginePhase !== "dry_run_ready" ||
    run.engineDryRunDigest !== binding.digest ||
    run.engineDryRunMappingVersion !== binding.mappingVersion ||
    report?.counts?.processed !== binding.totalCount ||
    (report?.counts?.created ?? 0) + (report?.counts?.updated ?? 0) !==
      binding.writes
  )
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  const [project] = await tx
    .select({ organisationId: schema.projectTable.organisationId })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, run.projectId),
        eq(schema.projectTable.workspaceId, run.workspaceId),
        isNull(schema.projectTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .for("share")
    .limit(1);
  if (!project)
    throw new HTTPException(404, { message: "Import run not found" });
  const [requester] = await tx
    .select({
      userId: personTable.userId,
      name: userTable.name,
      active: personTable.active,
      side: personTable.side,
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, input.requesterPersonId))
    .limit(1);
  if (
    !requester?.active ||
    requester.side !== "staff" ||
    requester.userId !== input.actorId
  )
    throw new HTTPException(403, { message: "Forbidden" });
  return {
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    organisationId: project.organisationId,
    actorName: requester.name,
    summary: {
      kind: "import_run",
      pluginId: run.pluginId,
      totalCount: binding.totalCount,
      writes: binding.writes,
      mappingVersion: binding.mappingVersion,
    },
    targetVersions: {
      [runId]: {
        digest: binding.digest,
        totalCount: binding.totalCount,
        mappingVersion: binding.mappingVersion,
        writes: binding.writes,
      },
    },
    confirmationRequired: "typed_count_step_up",
  };
}

async function resolveMcpApprovalDecisionRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  const approvalId = input.targetIds[0] ?? "";
  const [anchor] = await tx
    .select({
      workItemId: schema.approvalTable.workItemId,
      workspaceId: schema.approvalTable.workspaceId,
    })
    .from(schema.approvalTable)
    .where(eq(schema.approvalTable.id, approvalId))
    .limit(1);
  if (!anchor) throw new HTTPException(404, { message: "Approval not found" });
  const [target] = await tx
    .select({
      workItemId: schema.workItemTable.id,
      workItemKey: schema.workItemTable.key,
      workItemTitle: schema.workItemTable.title,
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      organisationId: schema.projectTable.organisationId,
      deletedAt: schema.workItemTable.deletedAt,
      archivedAt: schema.workItemTable.archivedAt,
      projectDeletedAt: schema.projectTable.deletedAt,
    })
    .from(schema.workItemTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .where(
      and(
        eq(schema.workItemTable.id, anchor.workItemId),
        eq(schema.workItemTable.workspaceId, anchor.workspaceId),
      ),
    )
    .for("update", { of: schema.workItemTable })
    .limit(1);
  if (
    !target ||
    target.deletedAt ||
    target.archivedAt ||
    target.projectDeletedAt
  )
    throw new HTTPException(404, { message: "Approval not found" });
  const [approval] = await tx
    .select({
      id: schema.approvalTable.id,
      workItemId: schema.approvalTable.workItemId,
      workspaceId: schema.approvalTable.workspaceId,
      kind: schema.approvalTable.kind,
      state: schema.approvalTable.state,
      expiresAt: schema.approvalTable.expiresAt,
    })
    .from(schema.approvalTable)
    .where(
      and(
        eq(schema.approvalTable.id, approvalId),
        eq(schema.approvalTable.workItemId, target.workItemId),
        eq(schema.approvalTable.workspaceId, target.workspaceId),
      ),
    )
    .for("update")
    .limit(1);
  if (approval?.state !== "pending")
    throw new HTTPException(409, { message: "Approval is no longer pending" });
  if (approval.expiresAt <= new Date())
    throw new HTTPException(409, { message: "Approval has expired" });
  if (
    target.workspaceId !== input.workspaceId &&
    input.workspaceId !== undefined
  ) {
    throw new HTTPException(404, { message: "Approval not found" });
  }

  const confirmationRequired = requiredConfirmation({
    action: input.action,
    targetType: input.targetType,
    targetCount: input.targetIds.length,
  });
  const payload = canonicalPendingActionPayload({
    action: input.action,
    route_key: input.routeKey,
    target_type: input.targetType,
    target_ids: input.targetIds,
    workspace_id: target.workspaceId,
    project_id: target.projectId,
    organisation_id: target.organisationId,
    confirmation_required: confirmationRequired,
    mcp_decision: input.mcpDecision,
  });
  const access = await evaluateActionRequiredAccess(tx, {
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    origin: input.origin,
    action: input.action,
    targetType: input.targetType,
    targetIds: input.targetIds,
    routeKey: input.routeKey,
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    organisationId: target.organisationId,
    confirmationRequired,
    payload,
    payloadHash: hashPendingActionPayload(payload),
  });
  if (!access.allowed) {
    throw new HTTPException(
      access.status === 404 ? 404 : access.status === 409 ? 409 : 403,
      {
        message:
          access.failure === "reach"
            ? "Approval not found"
            : access.failure === "unsupported"
              ? "Approval decision is no longer available"
              : "Insufficient permissions to request this approval decision",
      },
    );
  }
  const [requester] = await tx
    .select({
      userId: schema.personTable.userId,
      actorName: schema.userTable.name,
    })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .where(eq(schema.personTable.id, input.requesterPersonId))
    .limit(1);
  if (!requester || requester.userId !== input.actorId)
    throw new HTTPException(403, { message: "Forbidden" });

  return {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    organisationId: target.organisationId,
    actorName: requester.actorName,
    summary: {
      approvalId: approval.id,
      workItemKey: target.workItemKey,
      workItemTitle: target.workItemTitle,
      approvalKind: approval.kind,
      decision: input.mcpDecision?.action,
      note: input.mcpDecision?.note,
    },
  };
}

async function resolveHardPurgeRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  const targetId = input.targetIds[0];
  if (
    input.action !== "purge" ||
    input.routeKey !== "POST /api/instance/purge" ||
    !HARD_PURGE_TARGET_TYPES.includes(
      input.targetType as HardPurgeTargetType,
    ) ||
    !targetId ||
    input.targetIds.length !== 1
  )
    throw new HTTPException(400, {
      message: "Pending action target/action/route is unsupported",
    });
  if (input.origin !== "web" || input.credentialType !== "session")
    throw new HTTPException(403, { message: "session_required" });

  const targetType = input.targetType as HardPurgeTargetType;
  const target = { targetType, targetId };
  if (targetType === "organisation") {
    const check = await inspectHardPurgeTarget(tx, target);
    if (check.status === "not_found")
      throw new HTTPException(404, { message: "Target not found" });
    if (check.status !== "eligible")
      throw new HTTPException(409, {
        message: `hard_purge_${check.status}: ${"reason" in check ? check.reason : "target_changed"}`,
      });
    if (
      (input.workspaceId !== undefined && input.workspaceId !== null) ||
      (input.projectId !== undefined && input.projectId !== null) ||
      (input.organisationId !== undefined && input.organisationId !== targetId)
    )
      throw new HTTPException(404, { message: "Target not found" });

    const confirmationRequired = requiredConfirmation({
      action: input.action,
      targetType: input.targetType,
      targetCount: 1,
    });
    const access = await evaluateActionRequiredAccess(tx, {
      requestedByPersonId: input.requesterPersonId,
      credentialType: input.credentialType,
      credentialId: input.credentialId,
      origin: input.origin,
      action: input.action,
      targetType: input.targetType,
      targetIds: input.targetIds,
      routeKey: input.routeKey,
      workspaceId: null,
      projectId: null,
      organisationId: targetId,
      confirmationRequired,
    });
    if (!access.allowed)
      throw new HTTPException(access.status === 404 ? 404 : 403, {
        message: access.failure === "reach" ? "Out of reach" : "Forbidden",
      });

    const [actor] = await tx
      .select({ userId: personTable.userId, name: userTable.name })
      .from(personTable)
      .innerJoin(userTable, eq(userTable.id, personTable.userId))
      .where(eq(personTable.id, input.requesterPersonId))
      .limit(1);
    if (!actor || actor.userId !== input.actorId)
      throw new HTTPException(403, { message: "Forbidden" });
    const operationId = check.summary.operationId;
    const generation = check.summary.generation;
    if (!operationId || !Number.isSafeInteger(generation))
      throw new HTTPException(409, { message: "hard_purge_target_changed" });
    return {
      workspaceId: null,
      projectId: null,
      organisationId: targetId,
      actorName: actor.name,
      summary: {
        ...check.summary,
        name: check.summary.label ?? targetId,
        requesterName: actor.name,
      },
      targetVersions: {
        [targetId]: JSON.stringify({ operationId, generation }),
      },
    };
  }
  // Match execution lock order: hold placement is fenced before the target row.
  await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
  let workspaceId: string | undefined;
  let relatedProjectId: string | undefined;
  if (targetType === "work_item") {
    const [row] = await tx
      .select({
        workspaceId: schema.workItemTable.workspaceId,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, targetId))
      .for("update")
      .limit(1);
    workspaceId = row?.workspaceId;
    relatedProjectId = row?.projectId;
  } else {
    const [row] = await tx
      .select({
        workspaceId: schema.projectTable.workspaceId,
        projectId: schema.projectTable.id,
      })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, targetId))
      .for("update")
      .limit(1);
    workspaceId = row?.workspaceId;
    relatedProjectId = row?.projectId;
  }
  if (!workspaceId || !relatedProjectId)
    throw new HTTPException(404, { message: "Target not found" });

  const check = await inspectHardPurgeTarget(tx, target);
  if (check.status === "not_found")
    throw new HTTPException(404, { message: "Target not found" });
  if (check.status !== "eligible")
    throw new HTTPException(409, {
      message: `hard_purge_${check.status}: ${check.reason}`,
    });
  if (
    (input.workspaceId !== undefined && input.workspaceId !== workspaceId) ||
    (input.projectId !== undefined && input.projectId !== null) ||
    (input.organisationId !== undefined && input.organisationId !== null)
  )
    throw new HTTPException(404, { message: "Target not found" });

  const confirmationRequired = requiredConfirmation({
    action: input.action,
    targetType: input.targetType,
    targetCount: 1,
  });
  const access = await evaluateActionRequiredAccess(tx, {
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    origin: input.origin,
    action: input.action,
    targetType: input.targetType,
    targetIds: input.targetIds,
    routeKey: input.routeKey,
    workspaceId,
    projectId: null,
    organisationId: null,
    confirmationRequired,
  });
  if (!access.allowed)
    throw new HTTPException(access.status === 404 ? 404 : 403, {
      message: access.failure === "reach" ? "Out of reach" : "Forbidden",
    });

  const [actor] = await tx
    .select({ userId: personTable.userId, name: userTable.name })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, input.requesterPersonId))
    .limit(1);
  if (!actor || actor.userId !== input.actorId)
    throw new HTTPException(403, { message: "Forbidden" });
  const version = JSON.stringify({
    targetType,
    targetId,
    workspaceId,
    relatedProjectId,
    summary: check.summary,
  });
  return {
    workspaceId,
    projectId: null,
    organisationId: null,
    actorName: actor.name,
    summary: {
      ...check.summary,
      name: check.summary.label ?? targetId,
      requesterName: actor.name,
    },
    targetVersions: { [targetId]: version },
  };
}

async function resolveWorkspaceDeletionRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  const targetId = input.targetIds[0];
  if (!targetId || input.targetIds.length !== 1) {
    throw new HTTPException(400, {
      message: "Pending actions require one unique workspace target",
    });
  }
  const isCalendar = input.targetType === "service_calendar";
  const expectedRoute = isCalendar
    ? "DELETE /api/service-calendars/{id}"
    : "DELETE /api/views/{id}";
  if (input.routeKey !== expectedRoute) {
    throw new HTTPException(403, { message: "pending_action_policy_changed" });
  }
  if (
    !(
      (input.origin === "web" && input.credentialType === "session") ||
      ((input.origin === "api" || (!isCalendar && input.origin === "mcp")) &&
        input.credentialType === "api_key")
    )
  ) {
    throw new HTTPException(403, {
      message: "pending_action_credential_unsupported",
    });
  }

  let workspaceId: string;
  let version: number;
  let summary: Record<string, unknown>;
  if (isCalendar) {
    const [target] = await tx
      .select({
        id: serviceCalendarTable.id,
        workspaceId: serviceCalendarTable.workspaceId,
        name: serviceCalendarTable.name,
        version: serviceCalendarTable.version,
      })
      .from(serviceCalendarTable)
      .where(eq(serviceCalendarTable.id, targetId))
      .for("update")
      .limit(1);
    if (!target)
      throw new HTTPException(404, { message: "Service calendar not found" });
    workspaceId = target.workspaceId;
    version = target.version;
    summary = { name: target.name };
  } else {
    const [target] = await tx
      .select({
        id: savedViewTable.id,
        workspaceId: savedViewTable.workspaceId,
        createdBy: savedViewTable.createdBy,
        name: savedViewTable.name,
        scope: savedViewTable.scope,
        scopeId: savedViewTable.scopeId,
        visibility: savedViewTable.visibility,
        sharedWithTeamId: savedViewTable.sharedWithTeamId,
        updatedAt: savedViewTable.updatedAt,
      })
      .from(savedViewTable)
      .where(eq(savedViewTable.id, targetId))
      .for("update")
      .limit(1);
    if (!target)
      throw new HTTPException(404, { message: "Saved view not found" });
    workspaceId = target.workspaceId;
    version = target.updatedAt.getTime();
    summary = {
      name: target.name,
      scope: target.scope,
      scopeId: target.scopeId,
      visibility: target.visibility,
      sharedWithTeamId: target.sharedWithTeamId,
    };
  }
  if (
    (input.workspaceId !== undefined && input.workspaceId !== workspaceId) ||
    (input.projectId !== undefined && input.projectId !== null) ||
    (input.organisationId !== undefined && input.organisationId !== null)
  ) {
    throw new HTTPException(404, {
      message: "Pending action target not found",
    });
  }

  const access = await evaluateActionRequiredAccess(tx, {
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    origin: input.origin,
    action: input.action,
    targetType: input.targetType,
    targetIds: input.targetIds,
    routeKey: input.routeKey,
    workspaceId,
    projectId: null,
    organisationId: null,
    confirmationRequired: "click",
  });
  if (!access.allowed) {
    throw new HTTPException(access.status === 404 ? 404 : 403, {
      message: access.failure === "reach" ? "Out of reach" : "Forbidden",
    });
  }

  const [requester] = await tx
    .select({ userId: personTable.userId, name: userTable.name })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, input.requesterPersonId))
    .limit(1);
  if (!requester?.userId || requester.userId !== input.actorId) {
    throw new HTTPException(403, {
      message: "Pending-action requester is unavailable",
    });
  }
  return {
    workspaceId,
    projectId: null,
    organisationId: null,
    actorName: requester.name,
    summary: { ...summary, requesterName: requester.name },
    targetVersions: { [targetId]: version },
  };
}

async function resolveUserDeactivationScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  if (
    input.action !== "delete" ||
    input.targetType !== "user" ||
    input.credentialType !== "session" ||
    input.origin !== "web" ||
    input.routeKey !== "POST /api/instance/users/{id}/deactivate" ||
    input.actorType !== "person"
  ) {
    throw new HTTPException(403, { message: "session_required" });
  }
  const targetIds = [...new Set(input.targetIds)];
  if (targetIds.length !== 1 || targetIds.length !== input.targetIds.length) {
    throw new TypeError("User deactivation requires one unique user id");
  }
  const [target] = await tx
    .select({
      personId: personTable.id,
      userId: personTable.userId,
      targetUserId: userTable.id,
      active: personTable.active,
      isAnonymous: userTable.isAnonymous,
      email: userTable.email,
      name: userTable.name,
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(
      and(eq(userTable.id, targetIds[0] ?? ""), eq(personTable.active, true)),
    )
    .for("update")
    .limit(1);
  if (!target?.userId || target.isAnonymous) {
    throw new HTTPException(404, {
      message: "Pending action target not found",
    });
  }
  if (
    (input.workspaceId !== undefined && input.workspaceId !== null) ||
    (input.projectId !== undefined && input.projectId !== null) ||
    (input.organisationId !== undefined && input.organisationId !== null)
  ) {
    throw new HTTPException(404, {
      message: "Pending action target not found",
    });
  }
  const [requester] = await tx
    .select({
      userId: personTable.userId,
      active: personTable.active,
      actorName: userTable.name,
      banned: userTable.banned,
      role: userTable.role,
      side: personTable.side,
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, input.requesterPersonId))
    .for("update")
    .limit(1);
  if (
    !requester?.userId ||
    !requester.active ||
    requester.banned ||
    requester.side !== "staff"
  ) {
    throw new HTTPException(403, {
      message: "Pending-action requester is unavailable",
    });
  }
  if (requester.userId !== input.actorId) {
    throw new HTTPException(403, {
      message: "Pending-action requester mismatch",
    });
  }
  const route = policyRegistry.get(input.routeKey);
  if (
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.scope !== "instance" ||
    route.policy.capability !== "instance:admin"
  ) {
    throw new TypeError(
      "User deactivation requires its registered instance-admin route",
    );
  }
  const access = await evaluateActionRequiredAccess(tx, {
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
    origin: input.origin,
    action: input.action,
    targetType: input.targetType,
    targetIds: input.targetIds,
    routeKey: input.routeKey,
    workspaceId: null,
    projectId: null,
    organisationId: null,
    confirmationRequired: requiredConfirmation({
      action: input.action,
      targetType: input.targetType,
      targetCount: input.targetIds.length,
    }),
  });
  if (!access.allowed) {
    throw new HTTPException(access.status === 404 ? 404 : 403, {
      message: access.failure === "reach" ? "Out of reach" : "Forbidden",
    });
  }
  return {
    workspaceId: null,
    projectId: null,
    organisationId: null,
    actorName: requester.actorName,
    summary: {
      userId: target.targetUserId,
      personId: target.personId,
      name: target.name,
      email: target.email,
    },
  };
}

export async function toPublicPendingAction(
  row: typeof pendingActionTable.$inferSelect,
  publicFields?: PublicPendingActionFields,
) {
  const fields = publicFields ?? (await publicPendingActionFields(row));
  return {
    id: row.id,
    action: fields.action,
    origin: row.origin,
    targetType: fields.targetType,
    targetIds: fields.targetIds,
    summary: fields.summary,
    confirmation: row.confirmationRequired,
    approvalSupported: fields.approvalSupported,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null) {
    if (seen.has(current)) return false;
    seen.add(current);
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function assertRegisteredRouteKey(
  routeKey: string,
): asserts routeKey is Extract<keyof PolicyMap, string> {
  if (!policyRegistry.routeKeys.includes(routeKey)) {
    throw new TypeError(`Unknown pending-action route key: ${routeKey}`);
  }
}
