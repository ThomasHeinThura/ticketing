import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { pendingActionTable } from "../database/schema";
import { publishEvent } from "../events";
import {
  type ConfirmationKind,
  canonicalPendingActionPayload,
  hashPendingActionPayload,
  type PendingActionKind,
} from "./payload";

const ACTION_TTL_MS = 15 * 60 * 1000;

export type CreatePendingActionInput = {
  requesterPersonId: string;
  credentialType: "session" | "api_key";
  credentialId: string | null;
  origin: "web" | "api" | "mcp";
  action: PendingActionKind;
  routeKey: string;
  targetType: string;
  targetIds: readonly string[];
  targetVersions?: Record<string, unknown> | null;
  summary: Record<string, unknown>;
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
  confirmationRequired: ConfirmationKind;
  actorId: string;
  actorType: "person" | "api_key";
  actorIp?: string | null;
  userAgent?: string | null;
};

/** Creates the durable approval and its audit record before returning any 202 response. */
export async function createPendingAction(input: CreatePendingActionInput) {
  const payload = canonicalPendingActionPayload({
    action: input.action,
    route_key: input.routeKey,
    target_type: input.targetType,
    target_ids: input.targetIds,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    organisation_id: input.organisationId,
    confirmation_required: input.confirmationRequired,
  });
  const payloadHash = hashPendingActionPayload(payload);
  const now = new Date();
  const id = createId();
  const traceId = createId();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await db.transaction(async (tx) => {
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
            targetVersions: input.targetVersions ?? null,
            payload,
            routeKey: input.routeKey,
            payloadHash,
            payloadSummary: input.summary,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            organisationId: input.organisationId,
            confirmationRequired: input.confirmationRequired,
            state: "pending",
            createdAt: now,
            expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
            traceId,
          })
          .returning({ id: pendingActionTable.id });

        if (!created) throw new Error("Pending action insert returned no row");
        await appendAuditLog(tx, {
          actorId: input.actorId,
          actorType: input.actorType,
          apiKeyId:
            input.credentialType === "api_key" ? input.credentialId : null,
          actorIp: input.actorIp,
          userAgent: input.userAgent,
          traceId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          organisationId: input.organisationId,
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
            eq(pendingActionTable.targetIds, payload.target_ids),
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

  await publishEvent("pending_action.requested", {
    pendingActionId: id,
    action: input.action,
    origin: input.origin,
    targetType: input.targetType,
    targetCount: payload.target_ids.length,
    expiresAt: new Date(now.getTime() + ACTION_TTL_MS).toISOString(),
  });

  return {
    pendingActionId: id,
    action: input.action,
    summary: input.summary,
    confirmation: input.confirmationRequired,
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
    return updated;
  });

  await publishEvent("pending_action.decided", {
    pendingActionId: result.id,
    outcome: result.state,
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
