import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import { enqueueNotificationEvent } from "../notification/fanout";
import { resolvePendingActionEventRecipients } from "../notification/recipient-resolvers";
import { lockPendingActionLifecycle } from "./lifecycle-invalidation";

/**
 * PA-6 step 5 / PA-11: the terminal `failed` execution outcome.
 *
 * Every approval executor runs its deletion inside the approval transaction, so an
 * executor that throws rolls the whole approval back and the row would otherwise stay
 * `pending` with no record that the approved deletion was attempted. The executor's own
 * `execute` step is wrapped with {@link failOnExecutorError}; only an error raised there,
 * and not an expected refusal (`HTTPException`: confirmation mismatch, not pending,
 * target changed, step-up), is converted into a {@link PendingActionExecutionFailure}.
 * The approval route then records the terminal outcome in a separate transaction with
 * {@link recordPendingActionExecutionFailure}: state `failed`, `pending_action.decided`
 * (`approved`) and `pending_action.executed` (`outcome: failed`) events, both audit rows,
 * and the requester's failure notification.
 *
 * The stored/emitted error is a closed code, never the driver message: Drizzle wraps
 * driver errors in a message that embeds bound parameters (see utils/is-unique-violation.ts).
 */
export const PENDING_ACTION_EXECUTION_FAILED = "execution_failed" as const;

const SQLSTATE = /^[0-9A-Z]{5}$/;
const MAX_CAUSE_DEPTH = 5;

/** `execution_failed`, or `execution_failed:<SQLSTATE>` when a driver error carries one. */
export function pendingActionExecutionErrorCode(error: unknown): string {
  let candidate = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) break;
    const { code, cause } = candidate as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && SQLSTATE.test(code))
      return `${PENDING_ACTION_EXECUTION_FAILED}:${code}`;
    candidate = cause;
  }
  return PENDING_ACTION_EXECUTION_FAILED;
}

/**
 * Transient SQLSTATEs: serialization failure (40001), deadlock (40P01) and lock timeout
 * (55P03). The approval transaction rolled back and nothing was decided, so the action stays
 * `pending` and the approver may simply retry.
 */
const TRANSIENT_SQLSTATES: Readonly<
  Record<string, { status: 409 | 503; message: string }>
> = {
  "40001": { status: 409, message: "pending_action_retry" },
  "40P01": { status: 409, message: "pending_action_retry" },
  "55P03": { status: 503, message: "pending_action_busy_retry" },
};

/** The retryable HTTP refusal for a transient driver error (walking `cause`), else undefined. */
export function transientExecutionRefusal(
  error: unknown,
): HTTPException | undefined {
  let candidate = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) break;
    const { code, cause } = candidate as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && SQLSTATE.test(code)) {
      const transient = TRANSIENT_SQLSTATES[code];
      if (transient)
        return new HTTPException(transient.status, {
          message: transient.message,
          cause: error,
        });
      return undefined;
    }
    candidate = cause;
  }
  return undefined;
}

export class PendingActionExecutionFailure extends Error {
  readonly code: string;
  constructor(code: string, options: { cause: unknown }) {
    super("pending_action_execution_failed", options);
    this.name = "PendingActionExecutionFailure";
    this.code = code;
  }
}

/**
 * Marks errors thrown by an executor's `execute` step as execution failures. Expected
 * refusals (`HTTPException`) and caller-declared control-flow errors (for example the
 * identity grant-closure retry signal) pass through unchanged. Transient SQLSTATEs (40001,
 * 40P01, 55P03) become a retryable 409/503 so the action stays `pending`.
 */
export function failOnExecutorError<Args extends unknown[], Result>(
  execute: (...args: Args) => Promise<Result>,
  options: { passthrough?: (error: unknown) => boolean } = {},
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    try {
      return await execute(...args);
    } catch (error) {
      if (
        error instanceof HTTPException ||
        error instanceof PendingActionExecutionFailure ||
        options.passthrough?.(error)
      )
        throw error;
      // A transient conflict is retryable, not a terminal failure of the approved deletion.
      const transient = transientExecutionRefusal(error);
      if (transient) throw transient;
      throw new PendingActionExecutionFailure(
        pendingActionExecutionErrorCode(error),
        { cause: error },
      );
    }
  };
}

export type PendingActionExecutionFailureInput = {
  id: string;
  requesterPersonId: string;
  sessionId: string;
  traceId: string;
};

export type PendingActionExecutionFailureRecorder = (
  input: PendingActionExecutionFailureInput & { errorCode: string },
) => Promise<unknown>;

/**
 * Runs an approval. When its executor failed, records the terminal `failed` outcome and
 * answers `500 pending_action_failed`; any other error is rethrown unchanged.
 */
export async function withPendingActionFailureOutcome<Result>(
  input: PendingActionExecutionFailureInput,
  run: () => Promise<Result>,
  record: PendingActionExecutionFailureRecorder = recordPendingActionExecutionFailure,
): Promise<Result> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof PendingActionExecutionFailure)) throw error;
    await record({ ...input, errorCode: error.code });
    throw new HTTPException(500, {
      message: "pending_action_failed",
      cause: error,
    });
  }
}

/**
 * Moves a still-pending action to `failed` in its own transaction, after the executor's
 * transaction rolled back. A row that is no longer pending (decided concurrently) is left
 * untouched and `undefined` is returned.
 */
export async function recordPendingActionExecutionFailure(
  input: PendingActionExecutionFailureInput & { errorCode: string },
) {
  let auditFailures = 0;
  const failed = await db.transaction(async (tx) => {
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
    if (row?.state !== "pending") return undefined;
    const [actor] = await tx
      .select({ name: schema.userTable.name })
      .from(schema.personTable)
      .innerJoin(
        schema.userTable,
        eq(schema.userTable.id, schema.personTable.userId),
      )
      .where(eq(schema.personTable.id, input.requesterPersonId))
      .limit(1);
    const now = new Date();
    const [updated] = await tx
      .update(schema.pendingActionTable)
      .set({
        state: "failed",
        error: input.errorCode,
        decidedByPersonId: input.requesterPersonId,
        decisionSessionId: input.sessionId,
        decidedAt: now,
      })
      .where(
        and(
          eq(schema.pendingActionTable.id, row.id),
          eq(schema.pendingActionTable.state, "pending"),
        ),
      )
      .returning();
    if (!updated) return undefined;

    const scope = eventScope(row);
    const occurredAt = now.toISOString();
    await enqueueOutboxEvent(tx, {
      id: `evt_${createId()}`,
      kind: "pending_action.decided",
      occurredAt,
      actor: {
        type: "person",
        id: input.requesterPersonId,
        name: actor?.name ?? "Unknown user",
      },
      scope,
      payload: {
        key: row.id,
        url: `/dashboard/settings/account/pending-actions/${row.id}`,
        pendingActionId: row.id,
        outcome: "approved",
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    });
    // The failure is a system outcome, not the approver's act: a person actor equal to the
    // requester would be filtered out of the requester's own failure notification.
    await enqueueNotificationEvent(
      tx,
      {
        id: `evt_${createId()}`,
        kind: "pending_action.executed",
        occurredAt,
        actor: { type: "system", id: null, name: "TaskDesk" },
        scope,
        payload: {
          pendingActionId: row.id,
          action: row.action,
          targetIds: row.targetIds,
          outcome: "failed",
          error: input.errorCode,
        },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      },
      { resolveRecipients: resolvePendingActionEventRecipients },
    );

    const audits: Array<{
      action: string;
      before: JsonValue | null;
      after: JsonValue;
    }> = [
      {
        action: "pending_action.decided",
        before: { state: "pending" },
        after: { outcome: "approved" },
      },
      {
        action: "pending_action.executed",
        before: null,
        after: {
          outcome: "failed",
          state: "failed",
          error: input.errorCode,
          action: row.action,
          targetCount: row.targetIds.length,
        },
      },
    ];
    for (const audit of audits) {
      try {
        await tx.transaction((auditTx) =>
          appendAuditLog(auditTx, {
            actorId: input.requesterPersonId,
            actorType: "person",
            traceId: input.traceId,
            workspaceId: row.workspaceId,
            projectId: row.projectId,
            organisationId: row.organisationId,
            action: audit.action,
            entityType: "pending_action",
            entityId: row.id,
            before: audit.before,
            after: audit.after,
          }),
        );
      } catch {
        auditFailures += 1;
      }
    }
    return updated;
  });
  if (auditFailures > 0) {
    for (let index = 0; index < auditFailures; index += 1)
      recordAuditWriteFailure("pending_action_decision");
    await notifyCurrentInstanceAdminsOfAuditFailure("pending_action_decision");
  }
  return failed;
}
