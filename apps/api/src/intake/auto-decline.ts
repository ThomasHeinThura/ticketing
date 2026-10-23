import { createId } from "@paralleldrive/cuid2";
import {
  formatSubmissionReference,
  transitionSubmission,
} from "@taskdesk/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { eventScope } from "../events/outbox";
import { logTaskDesk } from "../instance/observability/runtime";
import { enqueueNotificationEvent } from "../notification/fanout";
import { resolveSubmissionRepliedRecipients } from "../notification/submission-recipients";

/**
 * IQ-15: a submission `clarifying` for longer than `instance_setting.clarification_window_days`
 * (default 14) is auto-declined, and only this decline is reopenable by the customer
 * (`submission.auto_declined_at`; a staff decline leaves it null). Run by `reminder-scan`.
 * The decline reason reaches the customer through `submission.declined` (reason verbatim);
 * no thread message is written because `submission_message.author_id` requires a person and
 * the system has none (decision requested in the handback).
 */

export const DEFAULT_CLARIFICATION_WINDOW_DAYS = 14;
const BATCH_SIZE = 50;
const MAX_PER_RUN = 500;

export function autoDeclineReason(days: number): string {
  return `No reply was received within ${days} days of our request for clarification, so this request was closed. Contact us if you would like to continue.`;
}

export async function findClarificationWindowDays(
  executor: Executor = db,
): Promise<number> {
  const [row] = await executor
    .select({ days: schema.instanceSettingTable.clarificationWindowDays })
    .from(schema.instanceSettingTable)
    .limit(1);
  return row?.days ?? DEFAULT_CLARIFICATION_WINDOW_DAYS;
}

export type AutoDeclineOutcome = {
  scanned: number;
  declined: number;
  degraded: boolean;
};

async function declineOne(
  submissionId: string,
  days: number,
): Promise<"declined" | "skipped"> {
  return db.transaction(async (tx) => {
    // Re-read under the row lock; a concurrent reply/decline makes this a no-op.
    const [row] = await tx
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(eq(schema.submissionTable.id, submissionId))
      .for("update", { of: schema.submissionTable })
      .limit(1);
    if (!row) return "skipped";
    const before = row.submission;
    const now = new Date();
    const reason = autoDeclineReason(days);
    const result = transitionSubmission(
      {
        number: before.number,
        state: before.state as never,
        claimedBy: before.claimedBy,
        claimedAt: before.claimedAt,
        clarifyingSince: before.clarifyingSince,
        staffMessageCount: 0,
      },
      {
        action: "auto_decline",
        actor: "triager", // the system acts on the staff side of the machine
        now,
        reason,
        clarifyingMaxDays: days,
      },
    );
    if (!result.ok) return "skipped";
    const [updated] = await tx
      .update(schema.submissionTable)
      .set({
        state: "declined",
        autoDeclinedAt: now,
        clarifyingSince: null,
        version: before.version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.submissionTable.id, before.id),
          eq(schema.submissionTable.version, before.version),
          eq(schema.submissionTable.state, "clarifying"),
        ),
      )
      .returning({ id: schema.submissionTable.id });
    if (!updated) return "skipped";
    const ref = formatSubmissionReference(before.number);
    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      workspaceId: row.workspaceId,
      organisationId: before.organisationId,
      action: "submission.declined",
      entityType: "submission",
      entityId: before.id,
      before: { state: "clarifying" },
      after: { number: before.number, state: "declined", auto: true, reason },
    });
    await enqueueNotificationEvent(
      tx,
      {
        id: `evt_${createId()}`,
        kind: "submission.declined",
        occurredAt: now.toISOString(),
        actor: { type: "system", id: null, name: "TaskDesk system" },
        scope: eventScope({
          workspaceId: row.workspaceId,
          organisationId: before.organisationId,
          projectId: null,
        }),
        payload: { ref, reason },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      },
      { resolveRecipients: resolveSubmissionRepliedRecipients },
    );
    return "declined";
  });
}

/** Bounded, per-row transactions; one failing row degrades the run but not the others. */
export async function autoDeclineStaleClarifications(): Promise<AutoDeclineOutcome> {
  const outcome: AutoDeclineOutcome = {
    scanned: 0,
    declined: 0,
    degraded: false,
  };
  const days = await findClarificationWindowDays();
  const seen = new Set<string>();
  while (outcome.scanned < MAX_PER_RUN) {
    const due = await db
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(
        and(
          eq(schema.submissionTable.state, "clarifying"),
          sql`${schema.submissionTable.clarifyingSince} <= now() - (${days} * interval '1 day')`,
        ),
      )
      .orderBy(asc(schema.submissionTable.clarifyingSince))
      .limit(BATCH_SIZE);
    const fresh = due.filter(({ id }) => !seen.has(id));
    if (fresh.length === 0) break;
    for (const { id } of fresh) {
      seen.add(id);
      outcome.scanned++;
      try {
        if ((await declineOne(id, days)) === "declined") outcome.declined++;
      } catch {
        outcome.degraded = true;
        logTaskDesk({
          module: "jobs",
          message: "jobs.failure",
          level: "error",
          result: "degraded",
        });
      }
    }
  }
  return outcome;
}
