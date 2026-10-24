import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, gt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { dbNowUtc } from "../utils/db-time";
import { lockPendingActionLifecycle } from "./lifecycle-invalidation";
import { evaluateActionRequiredAccess } from "./required-access";
import {
  type PendingActionTransaction,
  toPublicPendingAction,
} from "./service";

export type ClickDeletionApprovalInput = {
  id: string;
  requesterPersonId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  typedCount?: string;
  /** Exact target name for `typed_name_step_up` registered deletions (project, workspace). */
  typedName?: string;
  stepUpToken?: string;
};

/**
 * The current, locked facts of one registered deletion target. `version` is a deterministic
 * fingerprint of the row(s) the deletion depends on; any later change invalidates approval.
 */
export type RegisteredDeletionLoaded = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  organisationId: string | null;
  /** Human name; for `typed_name_step_up` targets the exact text the approver must type. */
  name: string;
  /** Request-time summary for the approval screen (names only; no secrets). */
  summary: Record<string, unknown>;
  /** Row facts for the route policy's `orOwner` branch (a delete-own capability needs the row's person). */
  rowFacts?: { personId?: string | null; createdBy?: string | null };
  version: string;
};

export type RegisteredDeletionEffect = {
  /** Side effects that must only run once the approval transaction has committed. */
  afterCommit?: () => Promise<void>;
};

/**
 * One legacy direct-delete route moved behind the pending-action flow. Definitions live in their
 * feature module; `deletion-targets.ts` holds the registry and the generic request/approval code.
 */
export type RegisteredDeletionTarget = {
  targetType: string;
  routeKey: string;
  /** Must equal `requiredConfirmation()` for this target type (payload.ts). */
  confirmation: "click" | "typed_name_step_up";
  /** Refuse API-key origins at request time as well as through the route policy. */
  sessionOnly: boolean;
  notFound: string;
  /**
   * Registered route whose project-scoped policy governs targets that load with a `projectId`;
   * `routeKey`'s policy then governs only the project-less (workspace) targets. For rows that
   * are owned either by a workspace or by one project (project-scoped automations).
   */
  projectPolicyRouteKey?: string;
  /** Load and lock the target in the module's own lock order; undefined when gone/out of scope. */
  load: (
    tx: PendingActionTransaction,
    id: string,
  ) => Promise<RegisteredDeletionLoaded | undefined>;
  /**
   * Extra reach a target needs beyond its route policy (customer invitations: the caller must
   * reach the organisation). False answers like a missing target (404), at request and at
   * execution.
   */
  callerReaches?: (
    tx: PendingActionTransaction,
    loaded: RegisteredDeletionLoaded,
    identity: ResolvedIdentity,
  ) => Promise<boolean>;
  /** Domain refusals (e.g. a non-empty column) raised at request time and again at execution. */
  assertDeletable?: (
    tx: PendingActionTransaction,
    loaded: RegisteredDeletionLoaded,
  ) => Promise<void>;
  execute: (
    tx: PendingActionTransaction,
    context: {
      row: typeof schema.pendingActionTable.$inferSelect;
      loaded: RegisteredDeletionLoaded;
      identity: ResolvedIdentity;
      input: ClickDeletionApprovalInput;
    },
  ) => Promise<RegisteredDeletionEffect>;
};

/** SHA-256 over a JSON-stable value: object keys are sorted before hashing. */
export function registeredDeletionFingerprint(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === "object" && !(input instanceof Date))
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, entry]) => [key, stable(entry)]),
      );
    if (input instanceof Date) return input.toISOString();
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export async function approveClickDeletion<Result>(
  input: ClickDeletionApprovalInput,
  executor: {
    targetType: string;
    routeKey: string;
    action?: "delete" | "bulk_delete";
    confirmation?: readonly string[];
    confirm?: (
      tx: PendingActionTransaction,
      row: typeof schema.pendingActionTable.$inferSelect,
      input: ClickDeletionApprovalInput,
    ) => Promise<{
      supplied: Record<string, unknown>;
      stepUpTokenId?: string;
      denied?: "step_up_required" | "step_up_expired";
    }>;
    summaryResult?: (result: Result) => unknown;
    execute: (
      tx: PendingActionTransaction,
      row: typeof schema.pendingActionTable.$inferSelect,
      input: ClickDeletionApprovalInput,
    ) => Promise<Result>;
    afterCommit?: (result: Result) => Promise<void>;
  },
) {
  let auditFailure = false;
  let executionResult: Result | undefined;
  let confirmation: {
    supplied: Record<string, unknown>;
    stepUpTokenId?: string;
    denied?: "step_up_required" | "step_up_expired";
  } = { supplied: { click: true } };
  const result = await db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    const [row] = await tx
      .select()
      .from(schema.pendingActionTable)
      .where(
        and(
          eq(schema.pendingActionTable.id, input.id),
          eq(
            schema.pendingActionTable.requestedByPersonId,
            input.requesterPersonId,
          ),
        ),
      )
      .for("update")
      .limit(1);
    if (!row)
      throw new HTTPException(404, { message: "Pending action not found" });
    if (row.state !== "pending")
      throw new HTTPException(409, { message: "pending_action_not_pending" });
    if (
      row.action !== (executor.action ?? "delete") ||
      row.targetType !== executor.targetType ||
      row.routeKey !== executor.routeKey ||
      !(executor.confirmation ?? ["click"]).includes(row.confirmationRequired)
    )
      throw new HTTPException(409, {
        message: "pending_action_kind_unsupported",
      });
    const [actor] = await tx
      .select({
        userId: schema.personTable.userId,
        active: schema.personTable.active,
        side: schema.personTable.side,
        name: schema.userTable.name,
        banned: schema.userTable.banned,
      })
      .from(schema.personTable)
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .where(eq(schema.personTable.id, input.requesterPersonId))
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
    if (!session || !actor || actor.userId !== input.userId)
      throw new HTTPException(403, { message: "Forbidden" });
    const now = new Date();
    const transition = async (
      state: "executed" | "expired" | "invalidated",
      reason?: string,
    ) => {
      const [updated] = await tx
        .update(schema.pendingActionTable)
        .set({
          state,
          invalidationReason: reason ?? null,
          decidedByPersonId: input.requesterPersonId,
          decisionSessionId: input.sessionId,
          decidedAt: now,
          ...(state === "executed"
            ? {
                executedAt: now,
                confirmationSupplied: confirmation.supplied,
                stepUpTokenId: confirmation.stepUpTokenId ?? null,
                ...(executor.summaryResult && executionResult !== undefined
                  ? {
                      payloadSummary: {
                        ...(row.payloadSummary &&
                        typeof row.payloadSummary === "object" &&
                        !Array.isArray(row.payloadSummary)
                          ? row.payloadSummary
                          : {}),
                        result: executor.summaryResult(executionResult),
                      },
                    }
                  : {}),
              }
            : {}),
        })
        .where(
          and(
            eq(schema.pendingActionTable.id, row.id),
            eq(schema.pendingActionTable.state, "pending"),
          ),
        )
        .returning();
      if (!updated)
        throw new HTTPException(409, { message: "pending_action_not_pending" });
      const events =
        state === "executed"
          ? (["pending_action.decided", "pending_action.executed"] as const)
          : (["pending_action.decided"] as const);
      for (const kind of events) {
        await enqueueOutboxEvent(tx, {
          id: `evt_${createId()}`,
          kind,
          occurredAt: now.toISOString(),
          actor: {
            type: "person",
            id: input.requesterPersonId,
            name: actor.name,
          },
          scope: eventScope(row),
          payload:
            kind === "pending_action.executed"
              ? {
                  pendingActionId: row.id,
                  action: row.action,
                  targetIds: row.targetIds,
                  outcome: "executed",
                }
              : {
                  key: row.id,
                  url: `/agent/settings/profile/pending-actions/${row.id}`,
                  pendingActionId: row.id,
                  outcome: state === "executed" ? "approved" : state,
                  ...(reason ? { invalidationReason: reason } : {}),
                },
          causationId: null,
          depth: 0,
          originAutomationId: null,
        });
        try {
          await tx.transaction((auditTx) =>
            appendAuditLog(auditTx, {
              actorId: input.requesterPersonId,
              actorType: "person",
              traceId: input.traceId,
              workspaceId: row.workspaceId,
              projectId: row.projectId,
              organisationId: row.organisationId,
              action: kind,
              entityType: "pending_action",
              entityId: row.id,
              before: { state: "pending" },
              after: {
                state,
                ...(reason ? { invalidationReason: reason } : {}),
              },
            }),
          );
        } catch {
          auditFailure = true;
        }
      }
      return updated;
    };
    if (!actor.active || actor.side !== "staff" || actor.banned)
      return transition(
        "invalidated",
        !actor.active ? "requester_deactivated" : "capability_removed",
      );
    if (row.expiresAt <= now) return transition("expired");
    // Original API-key ceiling and current human session must independently permit every stored target.
    const originalAccess = await evaluateActionRequiredAccess(tx, row, {
      existingPendingAction: true,
    });
    const sessionAccess = await evaluateActionRequiredAccess(tx, {
      ...row,
      credentialType: "session",
      credentialId: session.id,
    });
    const refused = !originalAccess.allowed
      ? originalAccess
      : !sessionAccess.allowed
        ? sessionAccess
        : undefined;
    if (refused) {
      const reason =
        refused.failure === "credential"
          ? "credential_revoked"
          : refused.failure === "reach"
            ? "reach_lost"
            : refused.failure === "capability"
              ? "capability_removed"
              : refused.failure === "target_version"
                ? "version_changed"
                : "scope_changed";
      return transition("invalidated", reason);
    }
    if (executor.confirm) confirmation = await executor.confirm(tx, row, input);
    if (confirmation.denied) return row;
    executionResult = await executor.execute(tx, row, input);
    return transition("executed");
  });
  if (auditFailure) {
    recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }
  if (confirmation.denied)
    throw new HTTPException(403, { message: confirmation.denied });
  if (result.state === "invalidated")
    throw new HTTPException(409, { message: "pending_action_target_changed" });
  if (
    result.state === "executed" &&
    executionResult !== undefined &&
    executor.afterCommit
  )
    await executor.afterCommit(executionResult);
  return { ...(await toPublicPendingAction(result)), executionResult };
}
