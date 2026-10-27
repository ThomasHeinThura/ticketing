import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import {
  evaluatePolicy,
  instanceScope,
  NO_PERSON_PARAMETER,
  NO_SINGLE_RESOURCE,
  projectScopeFromRow,
  type ResolvedIdentity,
  reaches,
  workspaceScopeFromRequest,
  workspaceScopeFromRow,
} from "@taskdesk/permissions";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  cycleDeletionTarget,
  moduleDeletionTarget,
} from "../agile/deletion-target";
import { clientIpForContext } from "../api-key/enforce";
import { personalKeyDeletionTarget } from "../api-key/personal-key-deletion-target";
import { serviceKeyDeletionTarget } from "../api-key/service-key-deletion-target";
import { appendAuditLog } from "../audit/audit-writer";
import { appendPendingActionStepUpAudit } from "../auth/step-up-audit";
import { consumePendingActionProof } from "../auth/step-up-service";
import { automationDeletionTarget } from "../automation/deletion-target";
import { cannedResponseDeletionTarget } from "../canned-response/canned-response-deletion-target";
import { columnDeletionTarget } from "../column/column-deletion-target";
import { customFieldDeletionTarget } from "../custom-field/deletion-target";
import db, { schema } from "../database";
import {
  pendingActionTable,
  personTable,
  savedViewTable,
  serviceCalendarTable,
  userPreferenceTable,
  userTable,
} from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { IdentityGrantClosureChangedError } from "../identity/errors";
import { databaseErrorCode } from "../identity/grant-closure-retry";
import {
  IMPORT_CHUNK_ROUTE,
  IMPORT_CHUNK_TARGET,
  IMPORT_LINK_CHUNK_ROUTE,
  IMPORT_RUN_ROUTE,
  IMPORT_RUN_TARGET,
} from "../imports/pending-action-contract";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { requestTypeDeletionTarget } from "../intake/deletion-target";
import { invitationDeletionTarget } from "../invitation/invitation-deletion-target";
import { kbCategoryDeletionTarget } from "../kb/deletion-target";
import {
  labelDeletionTarget,
  projectLabelDeletionTarget,
} from "../label/label-deletion-target";
import { type ApiKey, z } from "../openapi";
import { pageDeletionTarget } from "../pages/deletion-target";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import {
  documentLinkDeletionTarget,
  milestoneDeletionTarget,
  prerequisiteDeletionTarget,
  projectDeletionTarget,
} from "../project/project-deletion-target";
import { dashboardDeletionTarget } from "../report/deletion-target";
import { assertCalendarUnused } from "../service-calendar/repository";
import { serviceDeletionTarget } from "../service-management/deletion-target";
import { teamDeletionTarget } from "../team/deletion-target";
import { costEntryDeletionTarget } from "../time-tracking/cost-deletion-target";
import { timeEntryDeletionTarget } from "../time-tracking/deletion-target";
import { dbNowUtc } from "../utils/db-time";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import { webhookDeletionTarget } from "../webhook/deletion-target";
import {
  workspaceDeletionTarget,
  workspaceRoleDeletionTarget,
} from "../workspace/workspace-deletion-target";
import {
  BULK_WORK_ITEM_DELETION_ROUTE,
  bulkWorkItemDeletionStepUpAccess,
} from "./bulk-work-item-deletion-target";
import {
  approveClickDeletion,
  type ClickDeletionApprovalInput,
  invalidatedApprovalError,
  type RegisteredDeletionEffect,
  type RegisteredDeletionLoaded,
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  type RuntimeRegisteredDeletionTarget,
} from "./click-deletion-executor";
import { failOnExecutorError } from "./execution-failure";
import { identityConnectionDeletionTarget } from "./identity-connection-deletion-target";
import { lockPendingActionLifecycle } from "./lifecycle-invalidation";
import { organisationDeletionTarget } from "./organisation-deletion-target";
import {
  canonicalPendingActionPayload,
  hashPendingActionPayload,
} from "./payload";
import {
  type ActionRequiredAccessInput,
  evaluateActionRequiredAccess,
  type RequiredAccessDecision,
  resolvePendingActionCredentialIdentity,
} from "./required-access";
import type {
  CreatePendingActionInput,
  PendingActionTransaction,
} from "./service";
import {
  createPendingAction,
  requirePendingActionRequesterIdentity,
  toPublicPendingAction,
} from "./service";

/**
 * Pending-action targets owned by the saved-view and service-calendar slice (S7): request-time
 * scope resolution and approval-time execution for `DELETE /api/views/{id}` and
 * `DELETE /api/service-calendars/{id}`. Kept in its own module so `service.ts` carries only a
 * dispatch hunk for them. Ported from #589 `2350397b` (`pending-action/repository.ts`).
 */

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
          gt(schema.sessionTable.expiresAt, dbNowUtc()),
        ),
      )
      .for("update")
      .limit(1);
    if (!session || !actor?.userId || actor.userId !== input.userId) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    if (!actor.active || actor.side !== "staff" || actor.banned) {
      const invalidated = await invalidateServiceCalendarDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason: !actor.active ? "requester_deactivated" : "capability_removed",
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess: true,
      };
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
            action: "pending_action.decided",
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
    if (!calendar || calendar.workspaceId !== row.workspaceId) {
      const invalidated = await invalidateServiceCalendarDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason: "scope_changed",
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess: false,
      };
    }
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
        lostAccess: false,
        auditFailure: invalidated.auditFailure,
      };
    }
    const access = await evaluateActionRequiredAccess(
      tx,
      {
        requestedByPersonId: row.requestedByPersonId,
        credentialType: row.credentialType,
        credentialId: row.credentialId,
        action: row.action,
        targetType: row.targetType,
        targetIds: row.targetIds,
        routeKey: row.routeKey,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        organisationId: row.organisationId,
        confirmationRequired: row.confirmationRequired,
        payload,
        payloadHash: row.payloadHash,
        targetVersions: row.targetVersions,
      },
      { existingPendingAction: true },
    );
    if (!access.allowed) {
      const reason =
        access.failure === "credential"
          ? "credential_revoked"
          : access.failure === "reach"
            ? "reach_lost"
            : access.failure === "capability"
              ? "capability_removed"
              : null;
      if (!reason) {
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      }
      const invalidated = await invalidateServiceCalendarDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason,
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess:
          row.credentialType === "session" && reason !== "credential_revoked",
      };
    }
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
  if (result.state === "invalidated")
    throw invalidatedApprovalError(result.lostAccess);
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
          gt(schema.sessionTable.expiresAt, dbNowUtc()),
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
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess: true,
      };
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
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess: true,
      };
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
            action: "pending_action.decided",
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
      route.policy.capability !== "workspace:manage_settings" ||
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
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess: false,
      };
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
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess: false,
      };
    }
    const access = await evaluateActionRequiredAccess(
      tx,
      {
        requestedByPersonId: row.requestedByPersonId,
        credentialType: row.credentialType,
        credentialId: row.credentialId,
        action: row.action,
        targetType: row.targetType,
        targetIds: row.targetIds,
        routeKey: row.routeKey,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        organisationId: row.organisationId,
        confirmationRequired: row.confirmationRequired,
        payload,
        payloadHash: row.payloadHash,
        targetVersions: row.targetVersions,
      },
      { existingPendingAction: true },
    );
    if (!access.allowed) {
      const reason =
        access.failure === "credential"
          ? "credential_revoked"
          : access.failure === "reach"
            ? "reach_lost"
            : access.failure === "capability"
              ? "capability_removed"
              : null;
      if (!reason) {
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      }
      const invalidated = await invalidateSavedViewDeletion(tx, {
        row,
        actorPersonId: input.requesterPersonId,
        actorName: actor.name,
        sessionId: input.sessionId,
        traceId: input.traceId,
        reason,
        now,
      });
      auditFailure ||= invalidated.auditFailure;
      return {
        row: invalidated.row,
        state: "invalidated" as const,
        lostAccess:
          row.credentialType === "session" && reason !== "credential_revoked",
      };
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
  if (result.state === "invalidated")
    throw invalidatedApprovalError(result.lostAccess);
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

// ── Registered legacy direct-delete routes (P0 deletion audit) ──────────────────────────────
//
// Project, workspace, workspace-role, label, project-label, column, canned-response, milestone,
// prerequisite, document-link and invitation deletes used to execute immediately. Each is now a
// `RegisteredDeletionTarget` (defined in its feature module) and runs through the same durable
// request → requester approval → revalidated execution path as comment/attachment deletion.
// The four entry points below are the only hooks `service.ts`, `required-access.ts`,
// `approval-contract.ts`, `index.ts` and `auth/step-up-api.ts` need.

// Built on first use, not at module init: `service.ts` imports this module and the feature
// target modules import back into the pending-action graph, so an eagerly-built array could
// read a target binding before its module finished initialising (TDZ) depending on boot order.
let registeredDeletionTargetCache:
  | readonly RuntimeRegisteredDeletionTarget[]
  | undefined;
export function registeredDeletionTargets(): readonly RuntimeRegisteredDeletionTarget[] {
  if (!registeredDeletionTargetCache)
    registeredDeletionTargetCache = [
      projectDeletionTarget,
      workspaceDeletionTarget,
      workspaceRoleDeletionTarget,
      labelDeletionTarget,
      projectLabelDeletionTarget,
      columnDeletionTarget,
      cannedResponseDeletionTarget,
      milestoneDeletionTarget,
      prerequisiteDeletionTarget,
      documentLinkDeletionTarget,
      invitationDeletionTarget,
      serviceKeyDeletionTarget,
      personalKeyDeletionTarget,
      customFieldDeletionTarget,
      teamDeletionTarget,
      serviceDeletionTarget,
      kbCategoryDeletionTarget,
      requestTypeDeletionTarget,
      timeEntryDeletionTarget,
      costEntryDeletionTarget,
      webhookDeletionTarget,
      automationDeletionTarget,
      cycleDeletionTarget,
      moduleDeletionTarget,
      pageDeletionTarget,
      dashboardDeletionTarget,
      organisationDeletionTarget,
      identityConnectionDeletionTarget,
    ];
  return registeredDeletionTargetCache;
}

/** 202 body for a registered deletion request (click or typed-name + step-up). */
export const registeredDeletionRequestSchema = z.object({
  pendingActionId: z.string(),
  action: z.literal("delete"),
  summary: z.record(z.string(), z.unknown()),
  confirmation: z.enum(["click", "typed_name_step_up"]),
  expiresAt: z.string().datetime(),
  approveUrl: z.string(),
});

export function findRegisteredDeletionTarget(input: {
  action: string;
  targetType: string;
  routeKey: string;
}): RuntimeRegisteredDeletionTarget | undefined {
  if (input.action !== "delete") return undefined;
  return registeredDeletionTargets().find(
    (target) =>
      target.targetType === input.targetType &&
      target.routeKey === input.routeKey,
  );
}

type RuntimeRegisteredDeletionLoaded =
  | RegisteredDeletionLoaded<string>
  | RegisteredDeletionLoaded<null>;

type RuntimeRegisteredDeletionReadScope = RegisteredDeletionReadScope;

function assertRegisteredDeletionCanExecute(
  target: RuntimeRegisteredDeletionTarget,
  tx: PendingActionTransaction,
  loaded: RuntimeRegisteredDeletionLoaded,
) {
  return loaded.workspaceId === null
    ? (
        target as RegisteredDeletionTarget<RegisteredDeletionLoaded<null>>
      ).assertDeletable?.(tx, loaded as RegisteredDeletionLoaded<null>)
    : (
        target as RegisteredDeletionTarget<RegisteredDeletionLoaded<string>>
      ).assertDeletable?.(tx, loaded as RegisteredDeletionLoaded<string>);
}

function registeredDeletionCallerReaches(
  target: RuntimeRegisteredDeletionTarget,
  tx: PendingActionTransaction,
  loaded: RuntimeRegisteredDeletionLoaded | RuntimeRegisteredDeletionReadScope,
  identity: ResolvedIdentity,
): Promise<boolean> {
  if (loaded.workspaceId === null) {
    const predicate = (
      target as RegisteredDeletionTarget<RegisteredDeletionLoaded<null>>
    ).callerReaches;
    return predicate
      ? predicate(tx, loaded as RegisteredDeletionReadScope, identity)
      : Promise.resolve(true);
  }
  const predicate = (
    target as RegisteredDeletionTarget<RegisteredDeletionLoaded<string>>
  ).callerReaches;
  return predicate
    ? predicate(tx, loaded as RegisteredDeletionReadScope, identity)
    : Promise.resolve(true);
}

function executeRegisteredDeletionTarget(
  target: RuntimeRegisteredDeletionTarget,
  tx: PendingActionTransaction,
  context: {
    row: typeof schema.pendingActionTable.$inferSelect;
    loaded: RuntimeRegisteredDeletionLoaded;
    identity: ResolvedIdentity;
    input: ClickDeletionApprovalInput;
  },
): Promise<RegisteredDeletionEffect> {
  return context.loaded.workspaceId === null
    ? (
        target as RegisteredDeletionTarget<RegisteredDeletionLoaded<null>>
      ).execute(tx, {
        ...context,
        loaded: context.loaded as RegisteredDeletionLoaded<null>,
      })
    : (
        target as RegisteredDeletionTarget<RegisteredDeletionLoaded<string>>
      ).execute(tx, {
        ...context,
        loaded: context.loaded as RegisteredDeletionLoaded<string>,
      });
}

export function isRegisteredDeletion(input: {
  action: string;
  targetType: string;
  routeKey: string;
}): boolean {
  return findRegisteredDeletionTarget(input) !== undefined;
}

/** Workspace-scoped reach, the same membership/reach rule `evaluateWorkspaceDeletionAccess` uses. */
function workspaceInReach(identity: ResolvedIdentity, workspaceId: string) {
  return (
    identity.reach.kind === "all" ||
    (identity.reach.kind !== "organisation" &&
      ((identity.reach.kind === "membership_with_workspaces" &&
        identity.reach.workspaceIds.includes(workspaceId)) ||
        identity.memberships.some(
          (membership) =>
            membership.scope === "workspace" &&
            membership.scopeId === workspaceId,
        )))
  );
}

/**
 * Current access for one registered deletion: target exists in the stored scope, the route's
 * registered policy still allows this identity (reach first, then capability), and — for an
 * existing action — the frozen target fingerprint is unchanged.
 */
export async function evaluateRegisteredDeletionAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
  mode: "locked" | "read" = "locked",
): Promise<RequiredAccessDecision> {
  const target = findRegisteredDeletionTarget(input);
  const id = input.targetIds.length === 1 ? input.targetIds[0] : undefined;
  if (!target || !id || input.confirmationRequired !== target.confirmation)
    return { allowed: false, failure: "unsupported", status: 403 };
  if (target.sessionOnly && input.credentialType !== "session")
    return { allowed: false, failure: "credential", status: 403 };
  const loader = mode === "read" ? target.readScope : target.load;
  if (!loader) return { allowed: false, failure: "unsupported", status: 404 };
  const loaded = await loader(tx, id);
  if (
    !loaded ||
    loaded.workspaceId !== input.workspaceId ||
    loaded.projectId !== input.projectId ||
    loaded.organisationId !== input.organisationId
  )
    return { allowed: false, failure: "target_scope", status: 404 };
  const route = policyRegistry.get(
    loaded.projectId && target.projectPolicyRouteKey
      ? target.projectPolicyRouteKey
      : target.routeKey,
  );
  if (!route) return { allowed: false, failure: "unsupported", status: 403 };
  if (
    target.targetType === "organisation" ||
    target.targetType === "identity_connection"
  ) {
    if (
      input.action !== "delete" ||
      input.routeKey !==
        (target.targetType === "organisation"
          ? "DELETE /api/instance/organisations/{id}"
          : "DELETE /api/instance/identity-connections/{id}") ||
      input.targetIds.length !== 1 ||
      input.targetIds[0] !== loaded.id ||
      input.credentialType !== "session" ||
      input.workspaceId !== null ||
      input.projectId !== null ||
      loaded.workspaceId !== null ||
      loaded.projectId !== null ||
      loaded.organisationId !==
        (target.targetType === "organisation" ? loaded.id : null) ||
      (target.targetType === "identity_connection" &&
        input.organisationId !== null) ||
      route.kind !== "capability" ||
      !("capability" in route.policy) ||
      route.policy.scope !== "instance" ||
      route.policy.scopeSource !== "instance" ||
      route.policy.capability !== "instance:admin" ||
      route.policy.elevated !== true ||
      route.policy.sessionOnly !== true
    )
      return { allowed: false, failure: "unsupported", status: 403 };
    const decision = evaluatePolicy(route.policy, {
      identity,
      target: {},
      scope: instanceScope(),
      inReach: NO_SINGLE_RESOURCE,
    });
    if (!decision.allowed)
      return {
        allowed: false,
        failure: "capability",
        status: decision.status === 404 ? 404 : 403,
      };
    if (!(await registeredDeletionCallerReaches(target, tx, loaded, identity)))
      return { allowed: false, failure: "reach", status: 404 };
    if (
      mode === "locked" &&
      (input.payload !== undefined || input.targetVersions != null)
    ) {
      const versions =
        input.targetVersions &&
        typeof input.targetVersions === "object" &&
        !Array.isArray(input.targetVersions)
          ? (input.targetVersions as Record<string, unknown>)
          : null;
      if (
        !versions ||
        versions[loaded.id] !==
          (loaded as RuntimeRegisteredDeletionLoaded).version
      )
        return { allowed: false, failure: "target_version", status: 409 };
    }
    return { allowed: true };
  }
  if (route.kind === "self") {
    // Self routes have no tenant scope to infer. A registered self target must instead carry
    // its owner as a locked row fact, and only the same staff person may approve it.
    if (
      identity.side !== "staff" ||
      !loaded.rowFacts?.personId ||
      loaded.rowFacts.personId !== identity.personId ||
      loaded.workspaceId !== null ||
      loaded.projectId !== null ||
      loaded.organisationId !== null
    )
      return { allowed: false, failure: "reach", status: 404 };
    const decision = evaluatePolicy(route.policy, {
      identity,
      target: {},
      targetPersonId: NO_PERSON_PARAMETER,
    });
    if (!decision.allowed)
      return {
        allowed: false,
        failure: "reach",
        status: decision.status === 404 ? 404 : 403,
      };
  } else {
    if (
      route.kind !== "capability" ||
      !("capability" in route.policy) ||
      (route.policy.scope !== "project" && route.policy.scope !== "workspace")
    )
      return { allowed: false, failure: "unsupported", status: 403 };
    if (!loaded.workspaceId)
      return { allowed: false, failure: "unsupported", status: 403 };
    const policy = route.policy;
    const projectScoped = policy.scope === "project";
    if (projectScoped && !loaded.projectId)
      return { allowed: false, failure: "unsupported", status: 403 };
    // PR-2/PR-3: reach and authority on a child project follow its ancestor chain.
    const ancestorProjectIds =
      projectScoped && loaded.projectId
        ? await projectAncestryFor(
            tx,
            identity,
            loaded.workspaceId,
            loaded.projectId,
          )
        : undefined;
    const ownerTeamId =
      projectScoped && loaded.projectId
        ? await projectOwnerTeamFor(
            tx,
            identity,
            loaded.workspaceId,
            loaded.projectId,
          )
        : null;
    const decision = evaluatePolicy(policy, {
      identity,
      ...(ancestorProjectIds ? { ancestorProjectIds } : {}),
      target: {
        workspaceId: loaded.workspaceId,
        ...(loaded.projectId ? { projectId: loaded.projectId } : {}),
      },
      ...(loaded.rowFacts ? { row: loaded.rowFacts } : {}),
      scope: projectScoped
        ? projectScopeFromRow({
            projectId: loaded.projectId ?? "",
            workspaceId: loaded.workspaceId,
          })
        : policy.scopeSource === "request"
          ? workspaceScopeFromRequest({ workspaceId: loaded.workspaceId })
          : workspaceScopeFromRow({ workspaceId: loaded.workspaceId }),
      inReach: projectScoped
        ? reaches(identity, {
            workspaceId: loaded.workspaceId,
            projectId: loaded.projectId ?? "",
            organisationId: loaded.organisationId,
            ancestorProjectIds,
            ownerTeamId,
          })
        : workspaceInReach(identity, loaded.workspaceId),
    });
    if (!decision.allowed)
      return {
        allowed: false,
        failure: decision.status === 404 ? "reach" : "capability",
        status: decision.status === 404 ? 404 : 403,
      };
  }
  if (!(await registeredDeletionCallerReaches(target, tx, loaded, identity)))
    return { allowed: false, failure: "reach", status: 404 };
  if (
    mode === "locked" &&
    (input.payload !== undefined || input.targetVersions != null)
  ) {
    const versions =
      input.targetVersions &&
      typeof input.targetVersions === "object" &&
      !Array.isArray(input.targetVersions)
        ? (input.targetVersions as Record<string, unknown>)
        : null;
    if (
      !versions ||
      versions[id] !== (loaded as RuntimeRegisteredDeletionLoaded).version
    )
      return { allowed: false, failure: "target_version", status: 409 };
  }
  return { allowed: true };
}

/** Request-time scope for `createPendingAction`; scope always comes from the locked target. */
export async function resolveRegisteredDeletionRequestScope(
  tx: PendingActionTransaction,
  input: CreatePendingActionInput,
) {
  const target = findRegisteredDeletionTarget(input);
  const id = input.targetIds.length === 1 ? input.targetIds[0] : undefined;
  if (!target || !id)
    throw new HTTPException(400, {
      message: "Pending action target/action/route is unsupported",
    });
  if (
    !(
      (input.origin === "web" && input.credentialType === "session") ||
      (!target.sessionOnly &&
        (input.origin === "api" || input.origin === "mcp") &&
        input.credentialType === "api_key")
    )
  )
    throw new HTTPException(403, {
      message: target.sessionOnly
        ? "session_required: this deletion accepts a browser session only"
        : "pending_action_credential_unsupported",
    });
  const loaded = await target.load(tx, id);
  if (!loaded) throw new HTTPException(404, { message: target.notFound });
  if (
    (input.workspaceId !== undefined &&
      input.workspaceId !== loaded.workspaceId) ||
    (input.projectId !== undefined && input.projectId !== loaded.projectId) ||
    (input.organisationId !== undefined &&
      input.organisationId !== loaded.organisationId)
  )
    throw new HTTPException(404, { message: target.notFound });
  const identity = await resolvePendingActionCredentialIdentity(tx, {
    requestedByPersonId: input.requesterPersonId,
    credentialType: input.credentialType,
    credentialId: input.credentialId,
  });
  if (!("authority" in identity))
    throw new HTTPException(403, { message: "Forbidden" });
  const access = await evaluateRegisteredDeletionAccess(
    tx,
    {
      requestedByPersonId: input.requesterPersonId,
      credentialType: input.credentialType,
      credentialId: input.credentialId,
      action: input.action,
      targetType: input.targetType,
      targetIds: input.targetIds,
      routeKey: input.routeKey,
      workspaceId: loaded.workspaceId,
      projectId: loaded.projectId,
      organisationId: loaded.organisationId,
      confirmationRequired: target.confirmation,
    },
    identity,
  );
  if (!access.allowed)
    throw new HTTPException(access.status === 404 ? 404 : 403, {
      message: access.status === 404 ? target.notFound : "Forbidden",
    });
  await assertRegisteredDeletionCanExecute(target, tx, loaded);
  const [actor] = await tx
    .select({ userId: personTable.userId, name: userTable.name })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .where(eq(personTable.id, input.requesterPersonId));
  if (!actor || actor.userId !== input.actorId)
    throw new HTTPException(403, { message: "Forbidden" });
  return {
    workspaceId: loaded.workspaceId,
    projectId: loaded.projectId,
    organisationId: loaded.organisationId,
    actorName: actor.name,
    summary: {
      ...loaded.summary,
      targetType: target.targetType,
      // A click target may carry a display name that differs from the lookup name (a role's
      // `name` versus the `key` the reference checks run on). Typed-name targets always show
      // the exact name the person must type.
      name:
        target.confirmation === "click" &&
        typeof loaded.summary?.name === "string" &&
        loaded.summary.name.length > 0
          ? loaded.summary.name
          : loaded.name,
      requesterName: actor.name,
    },
    targetVersions: { [loaded.id]: loaded.version },
  };
}

/**
 * Approve one registered deletion. The shared click executor re-checks the requester, session,
 * expiry and both credential ceilings (through `evaluateActionRequiredAccess`, which must
 * dispatch registered targets to `evaluateRegisteredDeletionAccess`) before `execute` runs.
 */
export async function approveRegisteredDeletion(
  input: ClickDeletionApprovalInput,
) {
  const kind = await getPendingActionExecutionTarget({
    id: input.id,
    requesterPersonId: input.requesterPersonId,
  });
  const target = findRegisteredDeletionTarget(kind);
  if (!target)
    throw new HTTPException(409, {
      message: "pending_action_kind_unsupported",
    });
  const approve = () =>
    approveClickDeletion<RegisteredDeletionEffect>(input, {
      targetType: target.targetType,
      routeKey: target.routeKey,
      confirmation: [target.confirmation],
      retryGrantClosure: target.targetType === "identity_connection",
      ...(target.confirmation === "typed_name_step_up"
        ? {
            confirm: async (tx, row) => {
              const summary = row.payloadSummary as Record<string, unknown>;
              // The fingerprint check already proved the current name equals the frozen one.
              if (
                typeof summary?.name !== "string" ||
                input.typedName !== summary.name
              )
                throw new HTTPException(400, {
                  message: "confirmation_mismatch",
                });
              const proof = await consumePendingActionProof(tx, {
                token: input.stepUpToken ?? "",
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
                return {
                  supplied: {},
                  denied: input.stepUpToken
                    ? ("step_up_expired" as const)
                    : ("step_up_required" as const),
                };
              }
              await appendPendingActionStepUpAudit(tx, {
                action: "auth.step_up_consumed",
                actorId: input.userId,
                personId: input.requesterPersonId,
                pendingActionId: row.id,
                traceId: input.traceId,
              });
              return {
                supplied: { typedNameMatched: true, stepUp: true },
                stepUpTokenId: proof.id,
              };
            },
          }
        : {}),
      execute: failOnExecutorError(
        async (tx, row) => {
          const id = row.targetIds.length === 1 ? row.targetIds[0] : undefined;
          const loaded = id ? await target.load(tx, id) : undefined;
          if (!loaded)
            throw new HTTPException(409, {
              message: "pending_action_target_changed",
            });
          await assertRegisteredDeletionCanExecute(target, tx, loaded);
          const identity = await resolveIdentity(
            { userId: input.userId, credential: "session" },
            tx,
          );
          if (!identity || identity.personId !== input.requesterPersonId)
            throw new HTTPException(403, { message: "Forbidden" });
          const effect = await executeRegisteredDeletionTarget(target, tx, {
            row,
            loaded,
            identity,
            input,
          });
          // The approval's own `pending_action.executed` audit and outbox event record the
          // outcome (action, target ids); no per-entity audit key exists for these legacy targets.
          return effect;
        },
        {
          passthrough: (error) =>
            target.targetType === "identity_connection" &&
            (error instanceof IdentityGrantClosureChangedError ||
              ["40P01", "40001", "23503", "23505"].includes(
                databaseErrorCode(error) ?? "",
              )),
        },
      ),
      afterCommit: async (effect) => {
        await effect.afterCommit?.();
      },
    });
  const approved = await approve();
  const { executionResult: _effect, ...result } = approved;
  return result;
}

/** Admit only the requester's own current typed-name deletion, with both credential ceilings intact. */
export async function registeredDeletionStepUpAccess(
  executor: typeof db | PendingActionTransaction,
  input: { id: string; requesterPersonId: string; sessionId: string },
): Promise<boolean> {
  const check = async (tx: PendingActionTransaction) => {
    await lockPendingActionLifecycle(tx);
    const [row] = await tx
      .select()
      .from(pendingActionTable)
      .where(
        and(
          eq(pendingActionTable.id, input.id),
          eq(pendingActionTable.requestedByPersonId, input.requesterPersonId),
          eq(pendingActionTable.state, "pending"),
        ),
      )
      .for("update");
    const target = row ? findRegisteredDeletionTarget(row) : undefined;
    if (
      !row ||
      !target ||
      row.expiresAt <= new Date() ||
      target.confirmation !== "typed_name_step_up" ||
      row.confirmationRequired !== "typed_name_step_up"
    )
      return false;
    const original = await evaluateActionRequiredAccess(tx, row, {
      existingPendingAction: true,
    });
    if (!original.allowed) return false;
    return (
      await evaluateActionRequiredAccess(tx, {
        ...row,
        credentialType: "session",
        credentialId: input.sessionId,
      })
    ).allowed;
  };
  return executor === db
    ? db.transaction(check)
    : check(executor as PendingActionTransaction);
}

/** True for a pending action whose approval step-up is admitted by `registeredDeletionStepUpAccess`. */
export function isRegisteredStepUpDeletion(action: {
  action: string;
  targetType: string;
  routeKey: string;
  confirmation: string;
}): boolean {
  const target = findRegisteredDeletionTarget(action);
  return (
    target?.confirmation === "typed_name_step_up" &&
    action.confirmation === "typed_name_step_up"
  );
}

/**
 * Route-handler helper: turn a legacy DELETE into a durable pending deletion request and return
 * its 202 body. Scope assertions (`workspaceId`/`projectId`) come from the route's own
 * middleware/path; the persisted scope always comes from the locked target row.
 */
export async function requestRegisteredDeletion(
  c: Context,
  input: {
    routeKey: CreatePendingActionInput["routeKey"];
    targetType: string;
    id: string;
    workspaceId?: string;
    projectId?: string | null;
  },
) {
  const userId = c.get("userId") as string;
  const apiKey = c.get("apiKey") as ApiKey | undefined;
  const session = c.get("session") as { id?: string } | null;
  const requesterPersonId = await requirePendingActionRequesterIdentity(
    userId,
    apiKey,
  );
  const create = () =>
    createPendingAction({
      requesterPersonId,
      credentialType: apiKey ? "api_key" : "session",
      credentialId: apiKey?.id ?? session?.id ?? null,
      origin: apiKey ? "api" : "web",
      action: "delete",
      routeKey: input.routeKey,
      targetType: input.targetType,
      targetIds: [input.id],
      ...(input.workspaceId !== undefined
        ? { workspaceId: input.workspaceId }
        : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      actorId: userId,
      actorType: apiKey ? "api_key" : "person",
      actorIp: clientIpForContext(c),
      userAgent: c.req.header("user-agent") ?? null,
    });
  const created = await create();
  return registeredDeletionRequestSchema.parse(created);
}

/** Every pending deletion whose approval needs a PA-15 step-up proof: bulk typed-count, typed-name. */
export function isStepUpPendingDeletion(action: {
  action: string;
  targetType: string;
  routeKey: string;
  confirmation: string;
}): boolean {
  return (
    (action.action === "bulk_delete" &&
      action.targetType === "work_item" &&
      action.confirmation === "typed_count_step_up" &&
      action.routeKey === BULK_WORK_ITEM_DELETION_ROUTE) ||
    isRegisteredStepUpDeletion(action) ||
    (action.action === "mcp_destructive" &&
      action.targetType === IMPORT_CHUNK_TARGET &&
      action.confirmation === "typed_count_step_up" &&
      (action.routeKey === IMPORT_CHUNK_ROUTE ||
        action.routeKey === IMPORT_LINK_CHUNK_ROUTE)) ||
    (action.action === "mcp_destructive" &&
      action.targetType === IMPORT_RUN_TARGET &&
      action.confirmation === "typed_count_step_up" &&
      action.routeKey === IMPORT_RUN_ROUTE)
  );
}

/** Step-up admission for any step-up pending deletion (bulk typed-count or registered typed-name). */
export async function pendingDeletionStepUpAccess(
  executor: typeof db | PendingActionTransaction,
  input: { id: string; requesterPersonId: string; sessionId: string },
  options: { readOnly?: boolean } = {},
): Promise<boolean> {
  const importAccess = await importChunkStepUpAccess(executor, input, options);
  if (importAccess !== undefined) return importAccess;
  return (
    (await bulkWorkItemDeletionStepUpAccess(executor, input)) ||
    (await registeredDeletionStepUpAccess(executor, input))
  );
}

/** Current original-credential and browser-session access for the registered import chunk and run-level routes. */
async function importChunkStepUpAccess(
  executor: typeof db | PendingActionTransaction,
  input: { id: string; requesterPersonId: string; sessionId: string },
  options: { readOnly?: boolean },
): Promise<boolean | undefined> {
  const check = async (tx: PendingActionTransaction) => {
    if (!options.readOnly) await lockPendingActionLifecycle(tx);
    const query = tx
      .select()
      .from(pendingActionTable)
      .where(
        and(
          eq(pendingActionTable.id, input.id),
          eq(pendingActionTable.requestedByPersonId, input.requesterPersonId),
          eq(pendingActionTable.state, "pending"),
        ),
      );
    const [row] = await (options.readOnly ? query : query.for("update")).limit(
      1,
    );
    if (!row || row.expiresAt <= new Date()) return undefined;
    const isChunk =
      row.targetType === IMPORT_CHUNK_TARGET &&
      (row.routeKey === IMPORT_CHUNK_ROUTE ||
        row.routeKey === IMPORT_LINK_CHUNK_ROUTE);
    const isRun =
      row.targetType === IMPORT_RUN_TARGET && row.routeKey === IMPORT_RUN_ROUTE;
    if (
      row.action !== "mcp_destructive" ||
      row.confirmationRequired !== "typed_count_step_up" ||
      (!isChunk && !isRun)
    )
      return undefined;
    const accessOptions = {
      existingPendingAction: true,
      readOnly: options.readOnly,
    };
    const original = await evaluateActionRequiredAccess(tx, row, accessOptions);
    if (!original.allowed) return false;
    const session = await evaluateActionRequiredAccess(
      tx,
      {
        ...row,
        credentialType: "session",
        credentialId: input.sessionId,
      },
      accessOptions,
    );
    return session.allowed;
  };
  return executor === db
    ? db.transaction(check)
    : check(executor as PendingActionTransaction);
}
