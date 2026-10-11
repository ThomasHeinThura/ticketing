import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { and, eq, gt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import {
  pendingActionTable,
  personTable,
  projectTable,
  savedViewTable,
  serviceCalendarTable,
  slaPolicyVersionTable,
  userPreferenceTable,
  userTable,
} from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { policyRegistry } from "../policy-registry";
import { dbNowUtc } from "../utils/db-time";
import { lockPendingActionLifecycle } from "./lifecycle-invalidation";
import {
  canonicalPendingActionPayload,
  hashPendingActionPayload,
} from "./payload";
import { evaluateActionRequiredAccess } from "./required-access";
import type { PendingActionTransaction } from "./service";
import { toPublicPendingAction } from "./service";

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
      return { row: invalidated.row, state: "invalidated" as const };
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
      return { row: invalidated.row, state: "invalidated" as const };
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
      return { row: invalidated.row, state: "invalidated" as const };
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
