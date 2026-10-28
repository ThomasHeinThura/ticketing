import { createId } from "@paralleldrive/cuid2";
import {
  type Approval,
  type ApprovalKind,
  evaluateApprovalDecision,
  evaluateApprovalWithdrawalDecision,
  validateApprovalRequest,
} from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import type { AuditRequestContext } from "../audit/request-context";
import db, { type schema } from "../database";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { enqueueNotificationEvent } from "../notification/fanout";
import { resolveApprovalEventRecipients } from "../notification/recipient-resolvers";
import { recordWorkItemActivity } from "../work-item/activity";
import {
  closePendingApprovalRowsForTransition,
  findApprovalActorPerson,
  findApprovalWorkspaceOrganisation,
  hasWorkItemReach,
  insertApprovalForRequest,
  isActiveInstanceAdmin,
  isCabTeamMember,
  loadApprovalActorName,
  loadApprovalRequestFacts,
  loadApprovalTargetByKey,
  loadTransitionForWorkItem,
  lockApproval,
  lockLiveWorkItem,
  resolveApprovalFeatureFlag,
  resolveApprovalIdentityIfActive,
  updateApprovalDecision,
  updateApprovalWithdrawal,
} from "./repository";

type ActorType = "person" | "api_key";

/** The route's trusted-proxy ip, user agent, request id and API key for the audit row (P2R1-16). */
function auditFields(audit: Partial<AuditRequestContext> | undefined) {
  return {
    actorIp: audit?.actorIp ?? null,
    userAgent: audit?.userAgent ?? null,
    traceId: audit?.traceId ?? null,
    apiKeyId: audit?.apiKeyId ?? null,
  };
}
type ApprovalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  audit?: Partial<AuditRequestContext>;
}) {
  const now = new Date();
  let auditFailed = false;
  const target = await loadApprovalTargetByKey(input.identity, input.targetKey);
  if (!(await hasWorkItemReach(input.identity, target))) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  if (
    !(
      await resolveApprovalFeatureFlag({
        identity: input.identity,
        workspaceId: target.workspaceId,
        projectId: target.projectId,
      })
    ).enabled
  ) {
    throw new HTTPException(404, { message: "Approval requests are disabled" });
  }
  const { approver, type, expiryDays } = await loadApprovalRequestFacts(
    input.identity,
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
    !(await isCabTeamMember(
      input.identity,
      approver.userId,
      target.workspaceId,
      target.workItemId,
    ))
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
      input.identity,
      target.workspaceId,
      target.workItemId,
    );
    if (!lockedItem)
      throw new HTTPException(404, { message: "Work item not found" });

    const transition = await loadTransitionForWorkItem(tx, input.identity, {
      workItemId: target.workItemId,
      workspaceId: lockedItem.workspaceId,
      transitionId: input.transitionId,
    });
    if (!transition)
      throw new HTTPException(422, { message: "Transition not found" });

    const row = await insertApprovalForRequest(tx, input.identity, {
      id,
      // Anchored from the loaded, locked work item, never from the request.
      workspaceId: lockedItem.workspaceId,
      workItemId: target.workItemId,
      transitionId: input.transitionId,
      kind: input.kind,
      requestedBy: input.identity.personId,
      approverId: input.approverId,
      expiryDays,
      expiresAt: input.expiresAt,
    });
    if (!row) throw new Error("Approval request did not persist");

    const eventId = createId();
    await enqueueNotificationEvent(
      tx,
      {
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
          expiresAt: row.expiresAt.toISOString(),
        },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      },
      { resolveRecipients: resolveApprovalEventRecipients },
    );
    // AU-14: a failed audit append never fails the request, and is never silent.
    auditFailed = await appendAuditSavepoint(tx, {
      ...auditFields(input.audit),
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
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      },
    });
    return row;
  });
  if (auditFailed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return created;
}

export async function decideApproval(input: {
  approvalId: string;
  identity: ResolvedIdentity;
  actorType: ActorType;
  apiKeyId?: string;
  action: "approve" | "reject";
  note: string | null;
  isCabMember: boolean;
  target: Awaited<ReturnType<typeof loadApprovalTargetByKey>>;
  audit?: Partial<AuditRequestContext>;
}) {
  let auditFailed = false;
  const decided = await db.transaction((tx) =>
    decideApprovalInTransaction(tx, {
      ...input,
      onAuditFailure: () => {
        auditFailed = true;
      },
    }),
  );
  if (auditFailed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return decided;
}

/** Decide under a caller-owned transaction so a pending MCP action and the approval state,
 * activity, notification and audit commit or roll back together. */
export async function decideApprovalInTransaction(
  tx: ApprovalTransaction,
  input: {
    approvalId: string;
    identity: ResolvedIdentity;
    actorType: ActorType;
    apiKeyId?: string;
    action: "approve" | "reject";
    note: string | null;
    isCabMember: boolean;
    target: Awaited<ReturnType<typeof loadApprovalTargetByKey>>;
    audit?: Partial<AuditRequestContext>;
    /**
     * Called when the audit append failed in its savepoint (AU-14). The caller reports it after
     * its own commit; when omitted (a caller-owned transaction that cannot defer), the
     * administrators are notified here, before that commit.
     */
    onAuditFailure?: () => void;
  },
) {
  if (!(await hasWorkItemReach(input.identity, input.target))) {
    throw new HTTPException(403, {
      message: "Approver no longer has reach on this work item",
    });
  }
  const actorNameValue = await loadApprovalActorName(input.identity.personId);
  const lockedItem = await lockLiveWorkItem(
    tx,
    input.identity,
    input.target.workspaceId,
    input.target.workItemId,
  );
  if (!lockedItem)
    throw new HTTPException(404, { message: "Approval not found" });
  const row = await lockApproval(
    tx,
    input.identity,
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
  const updated = await updateApprovalDecision(tx, input.identity, {
    id: row.id,
    workspaceId: input.target.workspaceId,
    state: decision.nextState,
    decidedAt: now,
    decisionNote: input.note,
  });
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
  await enqueueNotificationEvent(
    tx,
    {
      id: `evt_${eventId}`,
      kind: "approval.decided",
      occurredAt: now.toISOString(),
      actor: {
        type: input.actorType,
        id: input.apiKeyId ?? input.identity.personId,
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
    },
    { resolveRecipients: resolveApprovalEventRecipients },
  );
  const decidedAuditFailed = await appendAuditSavepoint(tx, {
    ...auditFields(input.audit),
    actorId: input.identity.personId,
    actorType: input.actorType,
    apiKeyId: input.apiKeyId ?? input.audit?.apiKeyId ?? null,
    workspaceId: input.target.workspaceId,
    projectId: input.target.projectId,
    organisationId: input.target.organisationId,
    action: "approval.decided",
    entityType: "approval",
    entityId: row.id,
    before: { state: row.state },
    after: { state: decision.nextState, decidedAt: now.toISOString() },
  });
  if (decidedAuditFailed) {
    if (input.onAuditFailure) input.onAuditFailure();
    else await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  return updated;
}

export async function withdrawApproval(input: {
  approvalId: string;
  identity: ResolvedIdentity;
  actorType: ActorType;
  target: Awaited<ReturnType<typeof loadApprovalTargetByKey>>;
  /** True only for the dedicated admin route; current authority is rechecked under lock. */
  isInstanceAdmin: boolean;
  audit?: Partial<AuditRequestContext>;
}) {
  const name = await loadApprovalActorName(input.identity.personId);
  let auditFailed = false;
  const withdrawn = await db.transaction(async (tx) => {
    const lockedItem = await lockLiveWorkItem(
      tx,
      input.identity,
      input.target.workspaceId,
      input.target.workItemId,
      input.isInstanceAdmin,
    );
    if (!lockedItem)
      throw new HTTPException(404, { message: "Approval not found" });
    const row = await lockApproval(
      tx,
      input.identity,
      input.approvalId,
      input.target.workItemId,
      input.target.workspaceId,
      input.isInstanceAdmin,
    );
    if (!row) throw new HTTPException(404, { message: "Approval not found" });
    let isInstanceAdmin = false;
    if (input.isInstanceAdmin && input.identity.credential === "session") {
      isInstanceAdmin = await isActiveInstanceAdmin(tx, input.identity.userId);
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
    const updated = await updateApprovalWithdrawal(tx, input.identity, {
      id: row.id,
      workspaceId: input.target.workspaceId,
      decidedAt: now,
      allowInstanceAdmin: input.isInstanceAdmin,
    });
    if (!updated)
      throw new HTTPException(409, {
        message: "Approval is no longer pending",
      });
    const eventId = createId();
    await enqueueNotificationEvent(
      tx,
      {
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
      },
      { resolveRecipients: resolveApprovalEventRecipients },
    );
    auditFailed = await appendAuditSavepoint(tx, {
      ...auditFields(input.audit),
      actorId: input.identity.personId,
      actorType: input.actorType,
      workspaceId: input.target.workspaceId,
      projectId: input.target.projectId,
      organisationId: input.target.organisationId,
      action: "approval.withdrawn",
      entityType: "approval",
      entityId: row.id,
      before: { state: row.state },
      after: {
        state: "withdrawn",
        withdrawnAt: now.toISOString(),
        ...(isInstanceAdmin
          ? { via: "admin_route", onBehalfOfPersonId: row.requestedBy }
          : {}),
      },
    });
    return updated;
  });
  if (auditFailed) await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  return withdrawn;
}

/**
 * Owner decision 2026-10-10 ("close them on transition"): when a gated transition runs and
 * consumes approvals, every other approval for that transition on that work item that is
 * still pending is closed, in the transition's own transaction (the work item is locked).
 * It uses the existing terminal `expired` state: no new state value and no migration. Each
 * closure is audited as `approval.closed`, its inbox rows are removed, reminders skip it
 * (the scan only reads `pending`), and a later decide is refused with 409. No domain event
 * is emitted: `approval.expired` would tell the requester a time-out happened.
 */
export async function closePendingApprovalsOnTransition(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    identity: ResolvedIdentity;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    transitionId: string;
    /** The acting user's id; the audit row records the person id, like other `approval.*` rows. */
    actorId: string | null;
    actorType: "person" | "api_key" | "automation" | "system";
    audit?: Partial<AuditRequestContext>;
    /** Called once per audit append that failed in its savepoint (AU-14); the caller reports it. */
    onAuditFailure?: () => void;
  },
) {
  const closed = await closePendingApprovalRowsForTransition(
    tx,
    input.identity,
    input,
  );
  if (closed.length === 0) return closed;
  // The transition route's actor is a user id; approval audit rows carry the person id.
  const actorPerson = await findApprovalActorPerson(tx, input.actorId);
  const workspace = await findApprovalWorkspaceOrganisation(
    tx,
    input.workspaceId,
  );
  for (const approval of closed) {
    const failed = await appendAuditSavepoint(tx, {
      ...auditFields(input.audit),
      actorId: actorPerson?.id ?? null,
      actorType: input.actorType,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      organisationId: workspace?.organisationId ?? null,
      action: "approval.closed",
      entityType: "approval",
      entityId: approval.id,
      before: { state: "pending" },
      after: {
        state: "expired",
        reason: "transition_ran",
        transitionId: input.transitionId,
      },
    });
    if (failed) input.onAuditFailure?.();
  }
  return closed;
}
