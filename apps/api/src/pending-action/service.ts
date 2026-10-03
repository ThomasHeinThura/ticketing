import { createId } from "@paralleldrive/cuid2";
import { isCapability, type PolicyMap } from "@taskdesk/permissions";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import {
  apikeyTable,
  pendingActionTable,
  personTable,
  projectTable,
  userTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";
import { enqueueOutboxEvent } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import {
  type ConfirmationKind,
  canonicalPendingActionPayload,
  hashPendingActionPayload,
  type PendingActionKind,
  requiredConfirmation,
} from "./payload";
import { pendingActionReadSchema } from "./response";

const ACTION_TTL_MS = 15 * 60 * 1000;

export type CreatePendingActionInput = {
  requesterPersonId: string;
  credentialType: "session" | "api_key";
  credentialId: string | null;
  origin: "web" | "api" | "mcp";
  action: PendingActionKind;
  routeKey: keyof PolicyMap;
  targetType: string;
  targetIds: readonly string[];
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

/** Creates the durable approval and its audit record before returning any 202 response. */
export async function createPendingAction(input: CreatePendingActionInput) {
  assertRegisteredRouteKey(input.routeKey);
  const now = new Date();
  const id = createId();
  const traceId = createId();
  const conflictTargetIds = [...input.targetIds].sort();
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
      created = await db.transaction(async (tx) => {
        const scope = await resolveRequestScope(tx, input);
        const confirmation = requiredConfirmation({
          action: input.action,
          targetType: input.targetType,
          targetCount: input.targetIds.length,
        });
        const payload = canonicalPendingActionPayload({
          action: input.action,
          route_key: input.routeKey,
          target_type: input.targetType,
          target_ids: input.targetIds,
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          organisation_id: scope.organisationId,
          confirmation_required: confirmation,
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
            targetVersions: null,
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

        if (!created) throw new Error("Pending action insert returned no row");
        await enqueueOutboxEvent(tx, {
          id: `evt_${createId()}`,
          kind: "pending_action.requested",
          occurredAt: now.toISOString(),
          actor: {
            type: "person",
            id: input.requesterPersonId,
            name: scope.actorName,
          },
          scope: {
            workspaceId: scope.workspaceId,
            organisationId: scope.organisationId,
            projectId: scope.projectId,
          },
          payload: {
            key: id,
            url: `/agent/settings/profile/pending-actions/${id}`,
            pendingActionId: id,
            action: input.action,
            origin: input.origin,
            targetType: input.targetType,
            targetCount: payload.target_ids.length,
            expiresAt: new Date(now.getTime() + ACTION_TTL_MS).toISOString(),
          },
          causationId: null,
          depth: 0,
          originAutomationId: null,
        });

        try {
          await appendAuditLog(tx, {
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
              expiresAt: new Date(now.getTime() + ACTION_TTL_MS).toISOString(),
            },
          });
        } catch {
          requestAuditFailure = true;
        }
        return {
          confirmation,
          summary: scope.summary,
          auditFailure: requestAuditFailure,
        };
      });
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

  return {
    pendingActionId: id,
    action: input.action,
    summary: created.summary,
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
  const data = pageRows.map(({ pendingAction, requestingKeyName }) =>
    toPendingActionRead(pendingAction, requestingKeyName),
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
  const data = toPendingActionRead(
    result.pendingAction,
    result.requestingKeyName,
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
    const [actor] = await tx
      .select({
        userId: personTable.userId,
        name: userTable.name,
      })
      .from(personTable)
      .innerJoin(userTable, eq(userTable.id, personTable.userId))
      .where(eq(personTable.id, input.requesterPersonId))
      .limit(1);
    if (!actor?.userId || !row.workspaceId) {
      throw new HTTPException(403, {
        message: "Pending-action requester is unavailable",
      });
    }
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
      scope: {
        workspaceId: row.workspaceId,
        ...(row.organisationId ? { organisationId: row.organisationId } : {}),
        ...(row.projectId ? { projectId: row.projectId } : {}),
      },
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
    try {
      await appendAuditLog(tx, {
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
      });
    } catch {
      recordAuditWriteFailure("pending_action_decision");
      await notifyCurrentInstanceAdminsOfAuditFailure(
        "pending_action_decision",
      );
    }
    return updated;
  });

  return toPublicPendingAction(result);
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

function toPendingActionRead(
  row: typeof pendingActionTable.$inferSelect,
  requestingKeyName: string | null,
) {
  return pendingActionReadSchema.parse({
    id: row.id,
    action: row.action,
    origin: row.origin,
    targetType: row.targetType,
    targetIds: row.targetIds,
    summary: row.payloadSummary,
    confirmation: row.confirmationRequired,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    invalidationReason: row.invalidationReason,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    requestingKeyName,
  });
}

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type ResolvedRequestScope = {
  workspaceId: string;
  projectId: string;
  organisationId: string;
  actorName: string;
  summary: Record<string, unknown>;
};

/**
 * This persistence slice currently accepts only live work-item deletions. The
 * route's existing membership and capability checks are repeated here, then
 * scope is derived from the locked target and its parent rows. Other target
 * types stay refused until their row and reach resolvers are implemented.
 */
async function resolveRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  if (
    input.targetType !== "work_item" ||
    input.action !== "delete" ||
    input.targetIds.length !== 1
  ) {
    throw new HTTPException(400, {
      message:
        "Pending actions currently support registered single-work-item deletions only",
    });
  }

  const targetIds = [...new Set(input.targetIds)];
  if (targetIds.length === 0 || targetIds.length !== input.targetIds.length) {
    throw new TypeError("Pending action targets must be nonempty and unique");
  }

  const targets = await tx
    .select({
      key: workItemTable.key,
      title: workItemTable.title,
      projectName: projectTable.name,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      organisationId: workspaceTable.organisationId,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        inArray(workItemTable.key, targetIds),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .for("update")
    .limit(targetIds.length);

  if (targets.length !== targetIds.length) {
    throw new HTTPException(404, {
      message: "Pending action target not found",
    });
  }
  const [target] = targets;
  if (!target)
    throw new HTTPException(404, {
      message: "Pending action target not found",
    });
  if (
    targets.some(
      (row) =>
        row.workspaceId !== target.workspaceId ||
        row.projectId !== target.projectId ||
        row.organisationId !== target.organisationId,
    )
  ) {
    throw new HTTPException(404, {
      message: "Pending action target not found",
    });
  }

  if (
    (input.workspaceId !== undefined &&
      input.workspaceId !== target.workspaceId) ||
    (input.projectId !== undefined && input.projectId !== target.projectId) ||
    (input.organisationId !== undefined &&
      input.organisationId !== target.organisationId)
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
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, input.requesterPersonId))
    .limit(1);
  if (!requester?.userId || !requester.active || requester.banned) {
    throw new HTTPException(403, {
      message: "Pending-action requester is unavailable",
    });
  }

  if (input.credentialType === "api_key") {
    if (input.actorType !== "api_key" || input.actorId !== requester.userId) {
      throw new HTTPException(403, {
        message:
          "API-key credential does not match the pending-action requester",
      });
    }
    const [apiKey] = await tx
      .select({ id: apikeyTable.id })
      .from(apikeyTable)
      .where(
        and(
          eq(apikeyTable.id, input.credentialId ?? ""),
          or(
            eq(apikeyTable.referenceId, requester.userId),
            eq(apikeyTable.userId, requester.userId),
          ),
          eq(apikeyTable.enabled, true),
        ),
      )
      .for("update")
      .limit(1);
    if (!apiKey) {
      throw new HTTPException(403, {
        message:
          "API-key credential does not belong to the pending-action requester",
      });
    }
  }

  const route = policyRegistry.get(input.routeKey);
  if (
    input.routeKey !== "DELETE /api/work-items/{key}" ||
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.scope !== "work_item" ||
    !isCapability(route.policy.capability) ||
    route.policy.capability !== "work_item:delete"
  ) {
    throw new TypeError(
      "Pending-action route must be DELETE /api/work-items/{key}",
    );
  }

  await validateWorkspaceAccess(
    requester.userId,
    target.workspaceId,
    input.credentialType === "api_key"
      ? (input.credentialId ?? undefined)
      : undefined,
  );
  await assertCallerHasCapability(
    target.workspaceId,
    requester.userId,
    route.policy.capability,
  );

  return {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    organisationId: target.organisationId,
    actorName: requester.actorName,
    summary: {
      key: target.key,
      title: target.title,
      projectName: target.projectName,
      requesterName: requester.actorName,
    },
  };
}

function toPublicPendingAction(row: typeof pendingActionTable.$inferSelect) {
  return {
    id: row.id,
    action: row.action,
    origin: row.origin,
    targetType: row.targetType,
    targetIds: row.targetIds,
    summary: row.payloadSummary,
    confirmation: row.confirmationRequired,
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
): asserts routeKey is keyof PolicyMap {
  if (!policyRegistry.routeKeys.includes(routeKey)) {
    throw new TypeError(`Unknown pending-action route key: ${routeKey}`);
  }
}
