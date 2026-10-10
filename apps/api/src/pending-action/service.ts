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
  userTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
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
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import { apiKeyScopeFromStoredPermissions } from "../utils/require-api-key-permission-scope";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../utils/require-workspace-capability";
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
    const outcome = row.expiresAt <= now ? "expired" : input.outcome;
    const legacyInstanceUserDeactivation =
      isLegacyInstanceUserDeactivation(row);
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
        !legacyInstanceUserDeactivation)
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
      const now = new Date();
      let auditFailure = false;
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
        return { row: expired, state: "expired" as const, auditFailure: false };
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
          auditFailure: false,
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
          auditFailure: false,
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
        closure,
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
          auditFailure = true;
        }
      }
      return { row: executed, state: "executed" as const, auditFailure };
    }),
  );
  if (result.state === "invalidated") {
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  }
  if (result.auditFailure) {
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
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
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
    input.action === "delete" &&
    input.targetType === "user" &&
    input.routeKey === "POST /api/instance/users/{id}/deactivate" &&
    input.targetIds.length === 1
  ) {
    return resolveUserDeactivationScope(tx, input);
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

  let apiKeyScope:
    | ReturnType<typeof apiKeyScopeFromStoredPermissions>
    | undefined;
  if (input.credentialType === "api_key") {
    if (input.actorType !== "api_key" || input.actorId !== requester.userId) {
      throw new HTTPException(403, {
        message:
          "API-key credential does not match the pending-action requester",
      });
    }
    const keyCheckAt = new Date();
    const [apiKey] = await tx
      .select({ id: apikeyTable.id, permissions: apikeyTable.permissions })
      .from(apikeyTable)
      .where(
        and(
          eq(apikeyTable.id, input.credentialId ?? ""),
          or(
            eq(apikeyTable.referenceId, requester.userId),
            eq(apikeyTable.userId, requester.userId),
          ),
          eq(apikeyTable.enabled, true),
          or(
            isNull(apikeyTable.expiresAt),
            gt(apikeyTable.expiresAt, keyCheckAt),
          ),
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
    apiKeyScope = apiKeyScopeFromStoredPermissions(apiKey.permissions);
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
  if (input.credentialType === "api_key" && !apiKeyScope) {
    throw new HTTPException(403, {
      message: "API-key pending actions require a validated key scope",
    });
  }
  await assertCallerHasCapability(
    target.workspaceId,
    requester.userId,
    route.policy.capability,
    input.credentialType === "api_key" && apiKeyScope
      ? capabilityCredential(apiKeyScope)
      : { kind: "session" },
    tx,
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
