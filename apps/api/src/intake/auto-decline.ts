import { createId } from "@paralleldrive/cuid2";
import {
  formatSubmissionReference,
  transitionSubmission,
} from "@taskdesk/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { eventScope } from "../events/outbox";
import { logTaskDesk } from "../instance/observability/runtime";
import { enqueueNotificationEvent } from "../notification/fanout";
import { resolveSubmissionRepliedRecipients } from "../notification/submission-recipients";
import { appendIntakeAudit, withIntakeAudit } from "./audit";

/**
 * IQ-15: a submission `clarifying` for longer than `instance_setting.clarification_window_days`
 * (default 14) is auto-declined, and only this decline is reopenable by the customer
 * (`submission.auto_declined_at`; a staff decline leaves it null). Run by `reminder-scan`.
 * The decline writes a `system` thread message (`P2R1-05`, migration 0207) carrying the stable
 * reason code and its parameters, so the portal and the triage detail render it in the reader's
 * locale, plus the English text it was rendered with as the fallback body. The same reason
 * reaches the customer through `submission.declined` (inbox and, per preference, email).
 */

export const DEFAULT_CLARIFICATION_WINDOW_DAYS = 14;
const BATCH_SIZE = 50;
const MAX_PER_RUN = 500;
/** The stable reason code stored on the system message; the client owns its translations. */
export const AUTO_DECLINE_REASON_CODE = "clarification_window_expired";

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
    await tx.insert(schema.submissionMessageTable).values({
      submissionId: before.id,
      authorId: null,
      actorType: "system",
      body: reason,
      reasonCode: AUTO_DECLINE_REASON_CODE,
      reasonParams: { days },
      createdAt: now,
    });
    await appendIntakeAudit(tx, {
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

/**
 * Bounded, per-row transactions; one failing row degrades the run but not the others. The scan
 * walks the due rows by keyset `(clarifying_since, id)`, so rows that fail or are skipped never
 * hold back the rows behind them (`P2R1-P2`); a failed row is retried by the next run.
 */
export async function autoDeclineStaleClarifications(
  options: { batchSize?: number; maxPerRun?: number } = {},
): Promise<AutoDeclineOutcome> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxPerRun = options.maxPerRun ?? MAX_PER_RUN;
  const outcome: AutoDeclineOutcome = {
    scanned: 0,
    declined: 0,
    degraded: false,
  };
  return withIntakeAudit(async () => {
    const days = await findClarificationWindowDays();
    // The cursor keeps the stored value as text: a JS Date would drop the microseconds and
    // re-read (or skip) rows that share a millisecond.
    let cursor: { since: string; id: string } | null = null;
    while (outcome.scanned < maxPerRun) {
      const after: { since: string; id: string } | null = cursor;
      const due: { id: string; since: string | null }[] = await db
        .select({
          id: schema.submissionTable.id,
          since: sql<
            string | null
          >`${schema.submissionTable.clarifyingSince}::text`,
        })
        .from(schema.submissionTable)
        .where(
          and(
            eq(schema.submissionTable.state, "clarifying"),
            sql`${schema.submissionTable.clarifyingSince} <= now() - (${days} * interval '1 day')`,
            ...(after
              ? [
                  sql`(${schema.submissionTable.clarifyingSince}, ${schema.submissionTable.id}) > (${after.since}::timestamptz, ${after.id})`,
                ]
              : []),
          ),
        )
        .orderBy(
          asc(schema.submissionTable.clarifyingSince),
          asc(schema.submissionTable.id),
        )
        .limit(Math.min(batchSize, maxPerRun - outcome.scanned));
      if (due.length === 0) break;
      for (const { id } of due) {
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
      const last = due[due.length - 1];
      if (!last?.since) break;
      cursor = { since: last.since, id: last.id };
    }
    return outcome;
  });
}
