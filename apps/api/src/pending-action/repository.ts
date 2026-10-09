import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { isCapability, type PolicyMap } from "@taskdesk/permissions";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { consumePendingActionProof } from "../auth/step-up-service";
import db, { schema } from "../database";
import {
  apikeyTable,
  pendingActionTable,
  personTable,
  projectTable,
  savedViewTable,
  serviceCalendarTable,
  slaPolicyVersionTable,
  userPreferenceTable,
  userTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { transitionPersonLifecycleInTransaction } from "../identity/person-lifecycle";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import type { ApiKey } from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import type { ApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { parseApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { resolvePendingActionApprovalContract } from "./approval-contract";
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
  /** The native validated request key; used only to narrow capability checks. */
  apiKey?: ApiKey;
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
          scope: eventScope(scope),
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
          await tx.transaction(async (auditTx) =>
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

export async function getPendingActionExecutionTarget(input: {
  id: string;
  requesterPersonId: string;
}) {
  const [row] = await db
    .select({
      action: pendingActionTable.action,
      targetType: pendingActionTable.targetType,
      confirmationRequired: pendingActionTable.confirmationRequired,
      routeKey: pendingActionTable.routeKey,
    })
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.id, input.id),
        eq(pendingActionTable.requestedByPersonId, input.requesterPersonId),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(404, { message: "Pending action not found" });
  return row;
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
      toPendingActionRead(pendingAction, requestingKeyName),
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
    const publicFields = await publicPendingActionFields(row, tx);
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
    if (
      !actor?.userId ||
      (!row.workspaceId &&
        !(
          row.action === "delete" &&
          row.targetType === "user" &&
          row.routeKey === "POST /api/instance/users/{id}/deactivate"
        ) &&
        !isLegacyInstanceUserDeactivation(row))
    ) {
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
      scope: eventScope(row),
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

export async function approveServiceCalendarDeletion(input: {
  id: string;
  requesterPersonId: string;
  userId: string;
  sessionId: string;
  traceId: string;
}) {
  const now = new Date();
  let auditFailure = false;
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
    if (row.state !== "pending")
      throw new HTTPException(409, { message: "pending_action_not_pending" });
    if (
      row.action !== "delete" ||
      row.targetType !== "service_calendar" ||
      row.confirmationRequired !== "click"
    ) {
      throw new HTTPException(409, {
        message: "pending_action_kind_unsupported",
      });
    }
    const [actor] = await tx
      .select({
        userId: personTable.userId,
        active: personTable.active,
        side: personTable.side,
        name: userTable.name,
        banned: userTable.banned,
      })
      .from(personTable)
      .innerJoin(userTable, eq(userTable.id, personTable.userId))
      .where(eq(personTable.id, input.requesterPersonId))
      .for("update")
      .limit(1);
    const [session] = await tx
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(
        and(
          eq(schema.sessionTable.id, input.sessionId),
          eq(schema.sessionTable.userId, input.userId),
          eq(schema.sessionTable.portal, "agent"),
          gt(schema.sessionTable.expiresAt, sql`now()`),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !session ||
      !actor?.userId ||
      actor.userId !== input.userId ||
      !actor.active ||
      actor.side !== "staff" ||
      actor.banned
    ) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    if (row.expiresAt <= now) {
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
        scope: eventScope(row),
        payload: {
          key: row.id,
          url: `/agent/settings/profile/pending-actions/${row.id}`,
          pendingActionId: row.id,
          outcome: "expired",
        },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      });
      let expiryAuditFailure = false;
      try {
        await tx.transaction(async (auditTx) =>
          appendAuditLog(auditTx, {
            actorId: input.requesterPersonId,
            actorType: "person",
            traceId: input.traceId,
            workspaceId: row.workspaceId,
            action: "pending_action.expired",
            entityType: "pending_action",
            entityId: row.id,
            before: { state: "pending" },
            after: { state: "expired" },
          }),
        );
      } catch {
        expiryAuditFailure = true;
      }
      return {
        row: expired,
        state: "expired" as const,
        auditFailure: expiryAuditFailure,
      };
    }
    const route = policyRegistry.get(row.routeKey);
    if (
      row.routeKey !== "DELETE /api/service-calendars/{id}" ||
      route?.kind !== "capability" ||
      !("capability" in route.policy) ||
      route.policy.scope !== "workspace" ||
      route.policy.capability !== "sla_policy:manage"
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
    const targetId = row.targetIds.length === 1 ? row.targetIds[0] : undefined;
    if (
      !targetId ||
      hashPendingActionPayload(payload) !== row.payloadHash ||
      payload.action !== "delete" ||
      payload.target_type !== "service_calendar" ||
      payload.target_ids.length !== 1 ||
      payload.target_ids[0] !== targetId ||
      payload.route_key !== row.routeKey ||
      payload.workspace_id !== row.workspaceId ||
      row.projectId !== null ||
      row.organisationId !== null ||
      payload.project_id !== null ||
      payload.organisation_id !== null ||
      payload.confirmation_required !== "click" ||
      row.confirmationRequired !== "click"
    ) {
      throw new HTTPException(409, {
        message: "pending_action_payload_invalid",
      });
    }
    const [calendar] = await tx
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
    if (!calendar || calendar.workspaceId !== row.workspaceId)
      throw new HTTPException(404, { message: "Service calendar not found" });
    const targetVersions = row.targetVersions as Record<string, unknown> | null;
    if (!targetVersions || targetVersions[targetId] !== calendar.version) {
      const invalidated = await invalidateServiceCalendarDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason: "version_changed",
        now,
      });
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        auditFailure: invalidated.auditFailure,
      };
    }
    await validateWorkspaceAccess(input.userId, calendar.workspaceId);
    await assertCallerHasCapability(
      calendar.workspaceId,
      input.userId,
      "sla_policy:manage",
    );
    await assertCalendarUnused(tx, calendar.workspaceId, calendar.id);
    const [deleted] = await tx
      .delete(serviceCalendarTable)
      .where(
        and(
          eq(serviceCalendarTable.id, targetId),
          eq(serviceCalendarTable.workspaceId, calendar.workspaceId),
          eq(serviceCalendarTable.version, calendar.version),
        ),
      )
      .returning({ id: serviceCalendarTable.id });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    const [executed] = await tx
      .update(pendingActionTable)
      .set({
        state: "executed",
        confirmationSupplied: { click: true },
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
    const occurredAt = now.toISOString();
    for (const [kind, eventPayload] of [
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
        "service_calendar.deleted",
        {
          calendarId: calendar.id,
          workspaceId: calendar.workspaceId,
          name: calendar.name,
          url: "/agent/settings/calendars",
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
        scope: eventScope(row),
        payload: eventPayload,
        causationId: null,
        depth: 0,
        originAutomationId: null,
      });
    }
    for (const audit of [
      {
        action: "pending_action.decided",
        entityType: "pending_action",
        entityId: row.id,
        before: { state: "pending" },
        after: { outcome: "approved" },
      },
      {
        action: "service_calendar.deleted",
        entityType: "service_calendar",
        entityId: calendar.id,
        before: { name: calendar.name },
        after: null,
      },
      {
        action: "pending_action.executed",
        entityType: "pending_action",
        entityId: row.id,
        before: null,
        after: { outcome: "executed", action: row.action, targetCount: 1 },
      },
    ]) {
      try {
        await tx.transaction(async (auditTx) =>
          appendAuditLog(auditTx, {
            actorId: input.requesterPersonId,
            actorType: "person",
            traceId: input.traceId,
            workspaceId: row.workspaceId,
            action: audit.action,
            entityType: audit.entityType,
            entityId: audit.entityId,
            before: audit.before as JsonValue | null,
            after: audit.after as JsonValue | null,
          }),
        );
      } catch {
        auditFailure = true;
      }
    }
    return { row: executed, state: "executed" as const, auditFailure };
  });
  if (result.auditFailure) {
    recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }
  if (result.state === "invalidated") {
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  }
  return toPublicPendingAction(result.row);
}

export async function approveSavedViewDeletion(input: {
  id: string;
  requesterPersonId: string;
  userId: string;
  sessionId: string;
  traceId: string;
}) {
  const now = new Date();
  let auditFailure = false;
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
    if (
      row.action !== "delete" ||
      row.targetType !== "saved_view" ||
      row.confirmationRequired !== "click"
    ) {
      throw new HTTPException(409, {
        message: "pending_action_kind_unsupported",
      });
    }
    const [actor] = await tx
      .select({
        userId: personTable.userId,
        active: personTable.active,
        side: personTable.side,
        name: userTable.name,
        banned: userTable.banned,
      })
      .from(personTable)
      .innerJoin(userTable, eq(userTable.id, personTable.userId))
      .where(eq(personTable.id, input.requesterPersonId))
      .for("update")
      .limit(1);
    const [session] = await tx
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(
        and(
          eq(schema.sessionTable.id, input.sessionId),
          eq(schema.sessionTable.userId, input.userId),
          eq(schema.sessionTable.portal, "agent"),
          gt(schema.sessionTable.expiresAt, sql`now()`),
        ),
      )
      .for("update")
      .limit(1);
    if (!session || !actor?.userId || actor.userId !== input.userId) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    if (actor.active !== true) {
      const invalidated = await invalidateSavedViewDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason: "requester_deactivated",
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return { row: invalidated.row, state: "invalidated" as const };
    }
    if (actor.side !== "staff" || actor.banned) {
      const invalidated = await invalidateSavedViewDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason: "capability_removed",
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return { row: invalidated.row, state: "invalidated" as const };
    }
    if (row.expiresAt <= now) {
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
      if (!expired) {
        throw new HTTPException(409, { message: "pending_action_not_pending" });
      }
      await enqueueOutboxEvent(tx, {
        id: `evt_${createId()}`,
        kind: "pending_action.decided",
        occurredAt: now.toISOString(),
        actor: {
          type: "person",
          id: input.requesterPersonId,
          name: actor.name,
        },
        scope: eventScope(row),
        payload: {
          key: row.id,
          url: `/agent/settings/profile/pending-actions/${row.id}`,
          pendingActionId: row.id,
          outcome: "expired",
        },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      });
      try {
        await tx.transaction(async (auditTx) =>
          appendAuditLog(auditTx, {
            actorId: input.requesterPersonId,
            actorType: "person",
            traceId: input.traceId,
            workspaceId: row.workspaceId,
            projectId: row.projectId,
            organisationId: row.organisationId,
            action: "pending_action.expired",
            entityType: "pending_action",
            entityId: row.id,
            before: { state: "pending" },
            after: { state: "expired" },
          }),
        );
      } catch {
        auditFailure = true;
      }
      return { row: expired, state: "expired" as const };
    }

    const route = policyRegistry.get(row.routeKey);
    if (
      row.routeKey !== "DELETE /api/views/{id}" ||
      route?.kind !== "capability" ||
      !("capability" in route.policy) ||
      route.policy.scope !== "workspace" ||
      route.policy.capability !== "saved_view:create" ||
      !("orOwner" in route.policy) ||
      route.policy.orOwner?.predicate !==
        "row.created_by === identity.personId" ||
      route.policy.orOwner?.capability !== "saved_view:create"
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
    const targetId = row.targetIds.length === 1 ? row.targetIds[0] : undefined;
    if (
      !targetId ||
      hashPendingActionPayload(payload) !== row.payloadHash ||
      payload.action !== "delete" ||
      payload.target_type !== "saved_view" ||
      payload.target_ids.length !== 1 ||
      payload.target_ids[0] !== targetId ||
      payload.route_key !== row.routeKey ||
      payload.workspace_id !== row.workspaceId ||
      row.projectId !== null ||
      row.organisationId !== null ||
      payload.project_id !== null ||
      payload.organisation_id !== null ||
      payload.confirmation_required !== "click" ||
      row.confirmationRequired !== "click"
    ) {
      throw new HTTPException(409, {
        message: "pending_action_payload_invalid",
      });
    }
    let apiKeyScope: ApiKeyPermissionScope | undefined;
    if (row.credentialType === "api_key") {
      const [key] = await tx
        .select({ id: apikeyTable.id, permissions: apikeyTable.permissions })
        .from(apikeyTable)
        .where(
          and(
            eq(apikeyTable.id, row.credentialId ?? ""),
            or(
              eq(apikeyTable.referenceId, input.userId),
              eq(apikeyTable.userId, input.userId),
            ),
            eq(apikeyTable.enabled, true),
          ),
        )
        .for("update")
        .limit(1);
      if (!key) {
        const invalidated = await invalidateSavedViewDeletion(tx, {
          row,
          actorPersonId: input.requesterPersonId,
          actorName: actor.name,
          sessionId: input.sessionId,
          traceId: input.traceId,
          reason: "credential_revoked",
          now,
        });
        auditFailure ||= invalidated.auditFailure;
        return { row: invalidated.row, state: "invalidated" as const };
      }
      // PA-6 re-runs the request route's current authority. A key-originated request
      // remains bounded by that key's current stored scope when the requester approves
      // from their browser session; the browser session cannot widen the original request.
      apiKeyScope = parseApiKeyPermissionScope(key.permissions);
    }
    const [view] = await tx
      .select()
      .from(savedViewTable)
      .where(eq(savedViewTable.id, targetId))
      .for("update")
      .limit(1);
    if (!view || view.workspaceId !== row.workspaceId) {
      const invalidated = await invalidateSavedViewDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason: "scope_changed",
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return { row: invalidated.row, state: "invalidated" as const };
    }
    const targetVersions = row.targetVersions as Record<string, unknown> | null;
    if (
      !targetVersions ||
      targetVersions[targetId] !== view.updatedAt.getTime()
    ) {
      const invalidated = await invalidateSavedViewDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason: "version_changed",
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return { row: invalidated.row, state: "invalidated" as const };
    }
    try {
      await validateWorkspaceAccess(input.userId, view.workspaceId);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        const invalidated = await invalidateSavedViewDeletion(tx, {
          row,
          actorPersonId: input.requesterPersonId,
          actorName: actor.name,
          sessionId: input.sessionId,
          traceId: input.traceId,
          reason: "reach_lost",
          now,
        });
        auditFailure ||= invalidated.auditFailure;
        return { row: invalidated.row, state: "invalidated" as const };
      }
      throw error;
    }
    try {
      // Re-run the DELETE route's base capability before its owner/manager branch.
      // Both checks use the original key's current ceiling, matching request-time
      // middleware and resolveSavedViewScope.
      await assertCallerHasCapability(
        view.workspaceId,
        input.userId,
        "saved_view:create",
        apiKeyScope,
      );
      if (view.createdBy === input.requesterPersonId) {
        await assertCallerHasCapability(
          view.workspaceId,
          input.userId,
          "saved_view:create",
          apiKeyScope,
        );
      } else {
        await assertCallerHasCapability(
          view.workspaceId,
          input.userId,
          "workspace:manage_settings",
          apiKeyScope,
        );
      }
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        const invalidated = await invalidateSavedViewDeletion(tx, {
          row,
          actorPersonId: input.requesterPersonId,
          actorName: actor.name,
          sessionId: input.sessionId,
          traceId: input.traceId,
          reason: "capability_removed",
          now,
        });
        auditFailure ||= invalidated.auditFailure;
        return { row: invalidated.row, state: "invalidated" as const };
      }
      throw error;
    }

    const preferences = await tx
      .select({ id: userPreferenceTable.id, value: userPreferenceTable.value })
      .from(userPreferenceTable)
      .where(
        and(
          eq(userPreferenceTable.scope, "workspace"),
          eq(userPreferenceTable.scopeId, view.workspaceId),
          eq(userPreferenceTable.key, "pinned_view_ids"),
        ),
      )
      .for("update");
    for (const preference of preferences) {
      if (!Array.isArray(preference.value)) continue;
      const pinnedIds = preference.value.filter(
        (entry): entry is string => typeof entry === "string",
      );
      if (!pinnedIds.includes(targetId)) continue;
      await tx
        .update(userPreferenceTable)
        .set({ value: pinnedIds.filter((id) => id !== targetId) })
        .where(eq(userPreferenceTable.id, preference.id));
    }
    // `view` was re-read FOR UPDATE and its asserted version checked above. Holding that
    // row lock through this transaction makes a second timestamp equality redundant; in
    // particular, `updated_at` is a timestamp-without-time-zone column, so binding a JS
    // Date back into SQL can compare differently across database/session time zones.
    const [deleted] = await tx
      .delete(savedViewTable)
      .where(
        and(
          eq(savedViewTable.id, targetId),
          eq(savedViewTable.workspaceId, view.workspaceId),
        ),
      )
      .returning({ id: savedViewTable.id });
    if (!deleted) {
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    }
    const [executed] = await tx
      .update(pendingActionTable)
      .set({
        state: "executed",
        confirmationSupplied: { click: true },
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
    if (!executed) {
      throw new HTTPException(409, { message: "pending_action_not_pending" });
    }
    const occurredAt = now.toISOString();
    for (const [kind, eventPayload] of [
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
        "saved_view.deleted",
        { savedViewId: view.id, workspaceId: view.workspaceId },
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
        scope: eventScope(row),
        payload: eventPayload,
        causationId: null,
        depth: 0,
        originAutomationId: null,
      });
    }
    for (const audit of [
      {
        action: "pending_action.decided",
        entityType: "pending_action",
        entityId: row.id,
        before: { state: "pending" },
        after: { outcome: "approved" },
      },
      {
        action: "saved_view.deleted",
        entityType: "saved_view",
        entityId: view.id,
        before: {
          name: view.name,
          scope: view.scope,
          scopeId: view.scopeId,
          visibility: view.visibility,
          sharedWithTeamId: view.sharedWithTeamId,
          layout: view.layout,
        },
        after: null,
      },
      {
        action: "pending_action.executed",
        entityType: "pending_action",
        entityId: row.id,
        before: null,
        after: { outcome: "executed", action: row.action, targetCount: 1 },
      },
    ]) {
      try {
        await tx.transaction(async (auditTx) =>
          appendAuditLog(auditTx, {
            actorId: input.requesterPersonId,
            actorType: "person",
            traceId: input.traceId,
            workspaceId: row.workspaceId,
            action: audit.action,
            entityType: audit.entityType,
            entityId: audit.entityId,
            before: audit.before as JsonValue | null,
            after: audit.after as JsonValue | null,
          }),
        );
      } catch {
        auditFailure = true;
      }
    }
    return { row: executed, state: "executed" as const };
  });
  if (auditFailure) {
    recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }
  if (result.state === "invalidated") {
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  }
  return toPublicPendingAction(result.row);
}

async function invalidateSavedViewDeletion(
  tx: PendingActionTransaction,
  input: {
    row: typeof pendingActionTable.$inferSelect;
    actorPersonId: string;
    actorName: string;
    sessionId: string;
    traceId: string;
    reason:
      | "version_changed"
      | "scope_changed"
      | "reach_lost"
      | "capability_removed"
      | "credential_revoked"
      | "requester_deactivated";
    now: Date;
  },
) {
  const [invalidated] = await tx
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
  if (!invalidated) {
    throw new HTTPException(409, { message: "pending_action_not_pending" });
  }
  await enqueueOutboxEvent(tx, {
    id: `evt_${createId()}`,
    kind: "pending_action.decided",
    occurredAt: input.now.toISOString(),
    actor: { type: "person", id: input.actorPersonId, name: input.actorName },
    scope: eventScope(input.row),
    payload: {
      key: input.row.id,
      url: `/agent/settings/profile/pending-actions/${input.row.id}`,
      pendingActionId: input.row.id,
      outcome: "invalidated",
      invalidationReason: input.reason,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  let auditFailure = false;
  try {
    await tx.transaction(async (auditTx) =>
      appendAuditLog(auditTx, {
        actorId: input.actorPersonId,
        actorType: "person",
        traceId: input.traceId,
        workspaceId: input.row.workspaceId,
        projectId: input.row.projectId,
        organisationId: input.row.organisationId,
        action: "pending_action.decided",
        entityType: "pending_action",
        entityId: input.row.id,
        before: { state: "pending" },
        after: { state: "invalidated", invalidationReason: input.reason },
      }),
    );
  } catch {
    auditFailure = true;
  }
  return { row: invalidated, auditFailure };
}

async function invalidateServiceCalendarDeletion(
  tx: PendingActionTransaction,
  input: {
    row: typeof pendingActionTable.$inferSelect;
    actorPersonId: string;
    actorName: string;
    sessionId: string;
    traceId: string;
    reason: "version_changed" | "scope_changed";
    now: Date;
  },
) {
  const [invalidated] = await tx
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
  if (!invalidated)
    throw new HTTPException(409, { message: "pending_action_not_pending" });
  await enqueueOutboxEvent(tx, {
    id: `evt_${createId()}`,
    kind: "pending_action.decided",
    occurredAt: input.now.toISOString(),
    actor: { type: "person", id: input.actorPersonId, name: input.actorName },
    scope: eventScope(input.row),
    payload: {
      key: input.row.id,
      url: `/agent/settings/profile/pending-actions/${input.row.id}`,
      pendingActionId: input.row.id,
      outcome: "invalidated",
      invalidationReason: input.reason,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  let auditFailure = false;
  try {
    await tx.transaction(async (auditTx) =>
      appendAuditLog(auditTx, {
        actorId: input.actorPersonId,
        actorType: "person",
        traceId: input.traceId,
        workspaceId: input.row.workspaceId,
        action: "pending_action.invalidated",
        entityType: "pending_action",
        entityId: input.row.id,
        before: { state: "pending" },
        after: { state: "invalidated", invalidationReason: input.reason },
      }),
    );
  } catch {
    auditFailure = true;
  }
  return { row: invalidated, auditFailure };
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
  const now = new Date();
  let auditFailure = false;
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
        throw new HTTPException(409, { message: "pending_action_not_pending" });
      await writePersonDeactivationTransition(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: expiredBy?.name ?? "Unknown user",
        traceId: input.traceId,
        state: "expired",
        occurredAt: now,
      });
      return { row: expired, state: "expired" as const, auditFailure: false };
    }
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
      .for("update")
      .limit(1);
    const [session] = await tx
      .select({ id: schema.sessionTable.id })
      .from(schema.sessionTable)
      .where(
        and(
          eq(schema.sessionTable.id, input.sessionId),
          eq(schema.sessionTable.userId, input.userId),
          eq(schema.sessionTable.portal, "agent"),
          gt(schema.sessionTable.expiresAt, sql`now()`),
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
      const invalidated = await invalidatePersonDeactivation(tx, {
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
        auditFailure: false,
      };
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
    const [target] = await tx
      .select({
        id: personTable.id,
        userId: personTable.userId,
        targetUserId: userTable.id,
        active: personTable.active,
        email: userTable.email,
        name: userTable.name,
      })
      .from(personTable)
      .innerJoin(userTable, eq(userTable.id, personTable.userId))
      .where(eq(userTable.id, userId))
      .for("update")
      .limit(1);
    if (!target?.userId || target.targetUserId !== userId || !target.active) {
      const invalidated = await invalidatePersonDeactivation(tx, {
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
        auditFailure: false,
      };
    }
    const summary = row.payloadSummary as {
      email?: unknown;
      userId?: unknown;
    };
    if (summary.email !== target.email || summary.userId !== userId) {
      const invalidated = await invalidatePersonDeactivation(tx, {
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
        auditFailure: false,
      };
    }
    if (input.typedName !== target.email)
      throw new HTTPException(400, { message: "confirmation_mismatch" });
    const proof = await consumePendingActionProof(tx, {
      token: input.stepUpToken,
      personId: input.requesterPersonId,
      sessionId: input.sessionId,
      pendingActionId: row.id,
    });
    if (!proof) throw new HTTPException(403, { message: "step_up_expired" });
    const lifecycle = await transitionPersonLifecycleInTransaction(
      tx,
      target.id,
      false,
      "end_memberships",
      { kind: "administrative" },
    );
    if (!lifecycle)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
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
          action: "delete",
          targetIds: [target.userId],
          outcome: "executed",
        },
      ],
      [
        "identity.deprovisioned",
        {
          source: "god_mode",
          personId: target.id,
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
          action: "delete",
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
        auditFailure = true;
      }
    }
    return { row: executed, state: "executed" as const, auditFailure };
  });
  if (result.state === "invalidated") {
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  }
  if (result.auditFailure) {
    recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }
  return toPublicPendingAction(result.row);
}

async function invalidatePersonDeactivation(
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
  await writePersonDeactivationTransition(tx, {
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

async function writePersonDeactivationTransition(
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
        action: `pending_action.${input.state}`,
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
) {
  const publicFields = await publicPendingActionFields(row);
  return pendingActionReadSchema.parse({
    id: row.id,
    action: publicFields.action,
    origin: row.origin,
    targetType: publicFields.targetType,
    targetIds: publicFields.targetIds,
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

type PendingActionTransaction = Parameters<
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
): Promise<PublicPendingActionFields> {
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
  if (!isLegacyInstanceUserDeactivation(row)) {
    throw new HTTPException(409, {
      message: "pending_action_target_changed",
    });
  }

  const payload = row.payload as Record<string, unknown>;
  const summary = row.payloadSummary as Record<string, unknown>;
  const personId = row.targetIds.length === 1 ? row.targetIds[0] : undefined;
  if (
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
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
  actorName: string;
  summary: Record<string, unknown>;
  targetVersions?: Record<string, number>;
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
    input.action === "delete" &&
    input.targetType === "user" &&
    input.routeKey === "POST /api/instance/users/{id}/deactivate" &&
    input.targetIds.length === 1
  ) {
    return resolveUserDeactivationScope(tx, input);
  }
  if (input.action === "delete" && input.targetType === "service_calendar") {
    return resolveServiceCalendarScope(tx, input);
  }
  if (input.action === "delete" && input.targetType === "saved_view") {
    return resolveSavedViewScope(tx, input);
  }
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

async function resolveServiceCalendarScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  const ids = [...new Set(input.targetIds)];
  if (ids.length !== 1 || ids.length !== input.targetIds.length) {
    throw new HTTPException(400, {
      message: "service_calendar_delete_requires_one_target",
    });
  }
  if (
    !(
      (input.origin === "web" && input.credentialType === "session") ||
      (input.origin === "api" && input.credentialType === "api_key")
    )
  ) {
    throw new HTTPException(403, {
      message: "pending_action_credential_unsupported",
    });
  }
  const route = policyRegistry.get(input.routeKey);
  if (
    input.routeKey !== "DELETE /api/service-calendars/{id}" ||
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.scope !== "workspace" ||
    route.policy.capability !== "sla_policy:manage"
  ) {
    throw new HTTPException(403, { message: "pending_action_policy_changed" });
  }
  const [target] = await tx
    .select({
      id: serviceCalendarTable.id,
      workspaceId: serviceCalendarTable.workspaceId,
      name: serviceCalendarTable.name,
      version: serviceCalendarTable.version,
    })
    .from(serviceCalendarTable)
    .where(eq(serviceCalendarTable.id, ids[0] ?? ""))
    .for("update")
    .limit(1);
  if (!target)
    throw new HTTPException(404, { message: "Service calendar not found" });
  if (input.workspaceId != null && input.workspaceId !== target.workspaceId) {
    throw new HTTPException(404, { message: "Service calendar not found" });
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
    .for("update")
    .limit(1);
  if (
    !requester?.userId ||
    !requester.active ||
    requester.banned ||
    requester.userId !== input.actorId
  ) {
    throw new HTTPException(403, {
      message: "Pending-action requester is unavailable",
    });
  }
  if (input.credentialType === "api_key") {
    const [key] = await tx
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
    if (!key || input.actorType !== "api_key")
      throw new HTTPException(403, {
        message: "Pending-action requester is unavailable",
      });
  } else if (input.actorType !== "person") {
    throw new HTTPException(403, {
      message: "Pending-action requester is unavailable",
    });
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
    "sla_policy:manage",
  );
  await assertCalendarUnused(tx, target.workspaceId, target.id);
  return {
    workspaceId: target.workspaceId,
    projectId: null,
    organisationId: null,
    actorName: requester.actorName,
    summary: {
      name: target.name,
      calendarId: target.id,
      version: target.version,
    },
    targetVersions: { [target.id]: target.version },
  };
}

async function assertCalendarUnused(
  tx: PendingActionTransaction,
  workspaceId: string,
  calendarId: string,
) {
  const [projectReference] = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        eq(projectTable.serviceCalendarId, calendarId),
      ),
    )
    .limit(1);
  const [policyReference] = await tx
    .select({ id: slaPolicyVersionTable.id })
    .from(slaPolicyVersionTable)
    .where(
      and(
        eq(slaPolicyVersionTable.workspaceId, workspaceId),
        eq(slaPolicyVersionTable.calendarId, calendarId),
      ),
    )
    .limit(1);
  if (projectReference || policyReference) {
    throw new HTTPException(409, { message: "service_calendar_in_use" });
  }
}

async function resolveSavedViewScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
): Promise<ResolvedRequestScope> {
  const targetIds = [...new Set(input.targetIds)];
  if (targetIds.length !== 1 || targetIds.length !== input.targetIds.length) {
    throw new HTTPException(400, {
      message: "saved_view_delete_requires_one_target",
    });
  }
  if (
    !(
      (input.origin === "web" && input.credentialType === "session") ||
      ((input.origin === "api" || input.origin === "mcp") &&
        input.credentialType === "api_key")
    )
  ) {
    throw new HTTPException(403, {
      message: "pending_action_credential_unsupported",
    });
  }
  const route = policyRegistry.get(input.routeKey);
  if (
    input.routeKey !== "DELETE /api/views/{id}" ||
    input.action !== "delete" ||
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.scope !== "workspace" ||
    route.policy.capability !== "saved_view:create" ||
    !("orOwner" in route.policy) ||
    route.policy.orOwner?.predicate !==
      "row.created_by === identity.personId" ||
    route.policy.orOwner?.capability !== "saved_view:create"
  ) {
    throw new HTTPException(403, { message: "pending_action_policy_changed" });
  }
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
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, savedViewTable.workspaceId),
    )
    .where(eq(savedViewTable.id, targetIds[0] ?? ""))
    .for("update")
    .limit(1);
  if (!target) {
    throw new HTTPException(404, { message: "Saved view not found" });
  }
  if (
    (input.workspaceId !== undefined &&
      input.workspaceId !== target.workspaceId) ||
    (input.projectId !== undefined && input.projectId !== null) ||
    (input.organisationId !== undefined && input.organisationId !== null)
  ) {
    throw new HTTPException(404, { message: "Saved view not found" });
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
    .for("update")
    .limit(1);
  if (
    !requester?.userId ||
    !requester.active ||
    requester.banned ||
    requester.userId !== input.actorId
  ) {
    throw new HTTPException(403, {
      message: "Pending-action requester is unavailable",
    });
  }
  if (input.credentialType === "api_key") {
    const [key] = await tx
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
    if (!key || input.actorType !== "api_key" || input.apiKey?.id !== key.id) {
      throw new HTTPException(403, {
        message: "Pending-action requester is unavailable",
      });
    }
  } else if (input.actorType !== "person" || input.apiKey) {
    throw new HTTPException(403, {
      message: "Pending-action requester is unavailable",
    });
  }
  await validateWorkspaceAccess(
    requester.userId,
    target.workspaceId,
    input.credentialType === "api_key"
      ? (input.credentialId ?? undefined)
      : undefined,
  );
  if (target.createdBy === input.requesterPersonId) {
    await assertCallerHasCapability(
      target.workspaceId,
      requester.userId,
      "saved_view:create",
      input.apiKey,
    );
  } else {
    await assertCallerHasCapability(
      target.workspaceId,
      requester.userId,
      "workspace:manage_settings",
      input.apiKey,
    );
  }
  return {
    workspaceId: target.workspaceId,
    projectId: null,
    organisationId: null,
    actorName: requester.actorName,
    summary: {
      name: target.name,
      scope: target.scope,
      scopeId: target.scopeId,
      visibility: target.visibility,
      sharedWithTeamId: target.sharedWithTeamId,
      requesterName: requester.actorName,
    },
    targetVersions: { [target.id]: target.updatedAt.getTime() },
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
    requester.role !== "admin" ||
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

async function toPublicPendingAction(
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
