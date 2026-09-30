import { createId } from "@paralleldrive/cuid2";
import { isCapability, type PolicyMap } from "@taskdesk/permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import {
  pendingActionTable,
  personTable,
  projectTable,
  userTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";
import { enqueueOutboxEvent } from "../events/outbox";
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
  let created:
    | { confirmation: ConfirmationKind; summary: Record<string, unknown> }
    | undefined;

  if (input.targetVersions !== undefined && input.targetVersions !== null) {
    throw new TypeError(
      "Caller-supplied pending-action target versions are not supported",
    );
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
        } catch (error) {
          console.error("AU-14: pending-action audit write failed", error);
        }
        return { confirmation, summary: scope.summary };
      });
      break;
    } catch (error) {
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

  return {
    pendingActionId: id,
    action: input.action,
    summary: created.summary,
    confirmation: created.confirmation,
    expiresAt: new Date(now.getTime() + ACTION_TTL_MS).toISOString(),
    approveUrl: `/agent/settings/profile/pending-actions/${id}`,
  };
}

export async function getOwnPendingActions(requesterPersonId: string) {
  const rows = await db
    .select()
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.requestedByPersonId, requesterPersonId),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .orderBy(pendingActionTable.createdAt);

  for (const row of rows) await auditViewed(row.id, row);
  return rows.map(toPublicPendingAction);
}

export async function getOwnPendingAction(
  requesterPersonId: string,
  id: string,
) {
  const [row] = await db
    .select()
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.id, id),
        eq(pendingActionTable.requestedByPersonId, requesterPersonId),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(404, { message: "Pending action not found" });
  await auditViewed(row.id, row);
  return toPublicPendingAction(row);
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
    } catch (error) {
      console.error("AU-14: pending-action decision audit write failed", error);
    }
    return updated;
  });

  return toPublicPendingAction(result);
}

async function auditViewed(
  id: string,
  row: typeof pendingActionTable.$inferSelect,
) {
  await appendAuditLog(db, {
    actorId: row.requestedByPersonId,
    actorType: "person",
    traceId: row.traceId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    organisationId: row.organisationId,
    action: "pending_action.viewed",
    entityType: "pending_action",
    entityId: id,
    after: { rendered: true },
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
