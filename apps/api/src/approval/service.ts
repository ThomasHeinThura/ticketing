import { createId } from "@paralleldrive/cuid2";
import {
  type Approval,
  type ApprovalKind,
  evaluateApprovalDecision,
  evaluateApprovalWithdrawalDecision,
  validateApprovalRequest,
} from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { recordWorkItemActivity } from "../work-item/activity";
import {
  hasWorkItemReach,
  isCabTeamMember,
  loadApprovalActorName,
  loadApprovalRequestFacts,
  loadApprovalTargetByKey,
  loadTransitionForWorkItem,
  lockApproval,
  lockLiveWorkItem,
  resolveApprovalFeatureFlag,
  resolveApprovalIdentityIfActive,
} from "./repository";

type ActorType = "person" | "api_key";

function toDomainApproval(
  row: typeof schema.approvalTable.$inferSelect,
): Approval {
  return {
    id: row.id,
    transitionId: row.transitionId,
    kind: row.kind as ApprovalKind,
    requestedBy: row.requestedBy,
    approverId: row.approverId,
    state: row.state as Approval["state"],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    reminder50SentAt: row.reminder50SentAt,
    reminder90SentAt: row.reminder90SentAt,
  };
}

export async function createApproval(input: {
  targetKey: string;
  identity: ResolvedIdentity;
  actorType: ActorType;
  transitionId: string;
  kind: ApprovalKind;
  approverId: string;
  expiresAt?: Date;
}) {
  const now = new Date();
  const target = await loadApprovalTargetByKey(input.targetKey);
  if (!(await hasWorkItemReach(input.identity, target))) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  if (
    !(
      await resolveApprovalFeatureFlag({
        workspaceId: target.workspaceId,
        projectId: target.projectId,
      })
    ).enabled
  ) {
    throw new HTTPException(404, { message: "Approval requests are disabled" });
  }
  const { approver, type, expiryDays } = await loadApprovalRequestFacts(
    target.workItemId,
    target.workspaceId,
    input.approverId,
  );
  if (!approver?.userId) {
    throw new HTTPException(422, {
      message: "Approver must be an active person with an account",
    });
  }
  if (
    (input.kind === "customer" && approver.side !== "customer") ||
    (input.kind === "cab" && approver.side !== "staff")
  ) {
    throw new HTTPException(422, {
      message: "Approver is not eligible for this approval kind",
    });
  }
  if (
    input.kind === "cab" &&
    !(await isCabTeamMember(approver.userId, target.workspaceId))
  ) {
    throw new HTTPException(422, {
      message: "CAB approver must be a member of a CAB team in this workspace",
    });
  }
  const approverIdentity = await resolveApprovalIdentityIfActive(
    approver.userId,
  );
  if (
    !approverIdentity ||
    !(await hasWorkItemReach(approverIdentity, target))
  ) {
    throw new HTTPException(422, {
      message: "Approver is outside the work item's reach",
    });
  }

  const expiresAt =
    input.expiresAt ??
    new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  const result = validateApprovalRequest({
    kind: input.kind,
    requestedBy: input.identity.personId,
    approverId: input.approverId,
    expiresAt,
    now,
    isRequesterStaff: input.identity.side === "staff",
    isChangeType: type?.isChange ?? false,
  });
  if (!result.ok) {
    throw new HTTPException(422, {
      message: `Approval request refused: ${result.reasons.join(", ")}`,
    });
  }

  const id = createId();
  const name = await loadApprovalActorName(input.identity.personId);
  const created = await db.transaction(async (tx) => {
    const lockedItem = await lockLiveWorkItem(
      tx,
      target.workspaceId,
      target.workItemId,
    );
    if (!lockedItem)
      throw new HTTPException(404, { message: "Work item not found" });

    const transition = await loadTransitionForWorkItem(tx, {
      workItemId: target.workItemId,
      workspaceId: lockedItem.workspaceId,
      transitionId: input.transitionId,
    });
    if (!transition)
      throw new HTTPException(422, { message: "Transition not found" });

    const [row] = await tx
      .insert(schema.approvalTable)
      .values({
        id,
        // Anchored from the loaded, locked work item, never from the request.
        workspaceId: lockedItem.workspaceId,
        workItemId: target.workItemId,
        transitionId: input.transitionId,
        kind: input.kind,
        requestedBy: input.identity.personId,
        approverId: input.approverId,
        state: "pending",
        createdAt: now,
        expiresAt,
      })
      .returning();
    if (!row) throw new Error("Approval request did not persist");

    const eventId = createId();
    await enqueueOutboxEvent(tx, {
      id: `evt_${eventId}`,
      kind: "approval.requested",
      occurredAt: now.toISOString(),
      actor: { type: input.actorType, id: input.identity.personId, name },
      scope: eventScope({
        workspaceId: target.workspaceId,
        organisationId: target.organisationId,
        projectId: target.projectId,
      }),
      payload: {
        approvalId: id,
        approverId: input.approverId,
        kind: input.kind,
        expiresAt: expiresAt.toISOString(),
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    await appendAuditLog(tx, {
      actorId: input.identity.personId,
      actorType: input.actorType,
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      organisationId: target.organisationId,
      action: "approval.requested",
      entityType: "approval",
      entityId: id,
      after: {
        workItemId: target.workItemId,
        transitionId: input.transitionId,
        kind: input.kind,
        requestedBy: input.identity.personId,
        approverId: input.approverId,
        state: "pending",
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
    return row;
  });
  return created;
}

export async function decideApproval(input: {
  approvalId: string;
  identity: ResolvedIdentity;
  actorType: ActorType;
  action: "approve" | "reject";
  note: string | null;
  isCabMember: boolean;
  target: Awaited<ReturnType<typeof loadApprovalTargetByKey>>;
}) {
  if (!(await hasWorkItemReach(input.identity, input.target))) {
    throw new HTTPException(403, {
      message: "Approver no longer has reach on this work item",
    });
  }
  const actorNameValue = await loadApprovalActorName(input.identity.personId);
  return db.transaction(async (tx) => {
    const lockedItem = await lockLiveWorkItem(
      tx,
      input.target.workspaceId,
      input.target.workItemId,
    );
    if (!lockedItem)
      throw new HTTPException(404, { message: "Approval not found" });
    const row = await lockApproval(
      tx,
      input.approvalId,
      input.target.workItemId,
      input.target.workspaceId,
    );
    if (!row) throw new HTTPException(404, { message: "Approval not found" });
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new HTTPException(409, { message: "Approval has expired" });
    }
    const decision = evaluateApprovalDecision({
      approval: toDomainApproval(row),
      actingPersonId: input.identity.personId,
      action: input.action,
      note: input.note,
      cabMemberIds: input.isCabMember
        ? new Set([input.identity.personId])
        : new Set(),
    });
    if (!decision.ok) {
      const status = decision.reasons.includes("not_pending")
        ? 409
        : decision.reasons.includes("note_required")
          ? 422
          : 403;
      throw new HTTPException(status, {
        message: `Approval decision refused: ${decision.reasons.join(", ")}`,
      });
    }
    const now = new Date();
    const [updated] = await tx
      .update(schema.approvalTable)
      .set({
        state: decision.nextState,
        decidedAt: now,
        decisionNote: input.note,
      })
      .where(
        and(
          eq(schema.approvalTable.id, row.id),
          eq(schema.approvalTable.workspaceId, input.target.workspaceId),
          eq(schema.approvalTable.state, "pending"),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, {
        message: "Approval is no longer pending",
      });

    await recordWorkItemActivity(tx, [
      {
        workspaceId: input.target.workspaceId,
        workItemId: input.target.workItemId,
        actorId: input.identity.personId,
        actorType: input.actorType,
        verb: "approval.decided",
        oldValue: "pending",
        newValue: decision.nextState,
        payload: {
          approvalId: row.id,
          kind: row.kind,
          decision: decision.nextState,
        },
        visibility: "internal",
      },
    ]);
    const eventId = createId();
    await enqueueOutboxEvent(tx, {
      id: `evt_${eventId}`,
      kind: "approval.decided",
      occurredAt: now.toISOString(),
      actor: {
        type: input.actorType,
        id: input.identity.personId,
        name: actorNameValue,
      },
      scope: eventScope({
        workspaceId: input.target.workspaceId,
        organisationId: input.target.organisationId,
        projectId: input.target.projectId,
      }),
      payload: {
        approvalId: row.id,
        decision: decision.nextState,
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    await appendAuditLog(tx, {
      actorId: input.identity.personId,
      actorType: input.actorType,
      workspaceId: input.target.workspaceId,
      projectId: input.target.projectId,
      organisationId: input.target.organisationId,
      action: "approval.decided",
      entityType: "approval",
      entityId: row.id,
      before: { state: row.state },
      after: { state: decision.nextState, decidedAt: now.toISOString() },
    });
    return updated;
  });
}

export async function withdrawApproval(input: {
  approvalId: string;
  identity: ResolvedIdentity;
  actorType: ActorType;
  target: Awaited<ReturnType<typeof loadApprovalTargetByKey>>;
  /** True only for the dedicated admin route; current authority is rechecked under lock. */
  isInstanceAdmin: boolean;
}) {
  const name = await loadApprovalActorName(input.identity.personId);
  return db.transaction(async (tx) => {
    const lockedItem = await lockLiveWorkItem(
      tx,
      input.target.workspaceId,
      input.target.workItemId,
    );
    if (!lockedItem)
      throw new HTTPException(404, { message: "Approval not found" });
    const row = await lockApproval(
      tx,
      input.approvalId,
      input.target.workItemId,
      input.target.workspaceId,
    );
    if (!row) throw new HTTPException(404, { message: "Approval not found" });
    let isInstanceAdmin = false;
    if (input.isInstanceAdmin && input.identity.credential === "session") {
      const [admin] = await tx
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .innerJoin(
          schema.personTable,
          and(
            eq(schema.personTable.userId, schema.userTable.id),
            eq(schema.personTable.side, "staff"),
            eq(schema.personTable.active, true),
          ),
        )
        .where(
          and(
            eq(schema.userTable.id, input.identity.userId),
            eq(schema.userTable.role, "admin"),
          ),
        )
        .limit(1);
      isInstanceAdmin = admin !== undefined;
    }
    const withdrawal = evaluateApprovalWithdrawalDecision({
      approval: toDomainApproval(row),
      actingPersonId: input.identity.personId,
      isInstanceAdmin,
    });
    if (!withdrawal.authorized) {
      throw new HTTPException(403, {
        message: "Insufficient permissions to withdraw approval",
      });
    }
    if (!withdrawal.actionable) {
      throw new HTTPException(409, {
        message: "Approval is no longer pending",
      });
    }
    const now = new Date();
    const [updated] = await tx
      .update(schema.approvalTable)
      .set({ state: "withdrawn", decidedAt: now })
      .where(
        and(
          eq(schema.approvalTable.id, row.id),
          eq(schema.approvalTable.workspaceId, input.target.workspaceId),
          eq(schema.approvalTable.state, "pending"),
        ),
      )
      .returning();
    if (!updated)
      throw new HTTPException(409, {
        message: "Approval is no longer pending",
      });
    const eventId = createId();
    await enqueueOutboxEvent(tx, {
      id: `evt_${eventId}`,
      kind: "approval.withdrawn",
      occurredAt: now.toISOString(),
      actor: { type: input.actorType, id: input.identity.personId, name },
      scope: eventScope({
        workspaceId: input.target.workspaceId,
        organisationId: input.target.organisationId,
        projectId: input.target.projectId,
      }),
      payload: { approvalId: row.id, withdrawnBy: input.identity.personId },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    await appendAuditLog(tx, {
      actorId: input.identity.personId,
      actorType: input.actorType,
      workspaceId: input.target.workspaceId,
      projectId: input.target.projectId,
      organisationId: input.target.organisationId,
      action: "approval.withdrawn",
      entityType: "approval",
      entityId: row.id,
      before: { state: row.state },
      after: { state: "withdrawn", withdrawnAt: now.toISOString() },
    });
    return updated;
  });
}
