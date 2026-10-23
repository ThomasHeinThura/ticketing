import { sql } from "drizzle-orm";
import db from "../database";
import type { Executor, Transaction } from "../database/executor";
import type {
  ParentDrainResult,
  ParentFailureOutcome,
} from "./outbox-consumer";

export type ClaimedParentEvent = {
  eventId: string;
  kind: string;
  payload: unknown;
  attempts: number;
};

/**
 * Claims the oldest due `pending` parent with `FOR NO KEY UPDATE SKIP LOCKED` (so it never blocks
 * the FK key-share locks child rows take) and runs `process`
 * in the same transaction, so concurrent replicas never process one envelope twice and the
 * state transition commits atomically with whatever the consumers wrote. `outbox.next_attempt_at`
 * is `timestamptz`, so `now()` is the correct comparison (no UTC wall-clock conversion).
 */
export async function claimNextPendingParentEvent(
  process: (
    tx: Transaction,
    row: ClaimedParentEvent,
  ) => Promise<Exclude<ParentDrainResult, { kind: "idle" }>>,
): Promise<ParentDrainResult> {
  return db.transaction(async (tx) => {
    const claimed = await tx.execute<{
      event_id: string;
      kind: string;
      payload: unknown;
      attempts: number;
    }>(sql`
      SELECT "event_id", "kind", "payload", "attempts"
      FROM "outbox"
      WHERE "state" = 'pending' AND "next_attempt_at" <= now()
      ORDER BY "next_attempt_at" ASC, "created_at" ASC, "event_id" ASC
      LIMIT 1
      FOR NO KEY UPDATE SKIP LOCKED
    `);
    const row = claimed.rows[0];
    if (!row) return { kind: "idle" as const };
    return process(tx, {
      eventId: row.event_id,
      kind: row.kind,
      payload: row.payload,
      attempts: Number(row.attempts),
    });
  });
}

/** `pending → delivered`. Guarded on `pending` so a replay can never move a terminal row. */
export async function markParentEventDelivered(
  executor: Executor,
  eventId: string,
  attemptsBefore: number,
): Promise<void> {
  await executor.execute(sql`
    UPDATE "outbox"
    SET "state" = 'delivered',
        "attempts" = ${attemptsBefore + 1},
        "last_error" = NULL,
        "updated_at" = now()
    WHERE "event_id" = ${eventId} AND "state" = 'pending'
  `);
}

/** Records a failed attempt: backoff while attempts remain, otherwise dead-letter. */
export async function markParentEventFailed(
  executor: Executor,
  eventId: string,
  outcome: ParentFailureOutcome,
  lastError: string,
): Promise<void> {
  if (outcome.state === "dead") {
    await executor.execute(sql`
      UPDATE "outbox"
      SET "state" = 'dead',
          "attempts" = ${outcome.attempts},
          "last_error" = ${lastError},
          "updated_at" = now()
      WHERE "event_id" = ${eventId} AND "state" = 'pending'
    `);
    return;
  }
  await executor.execute(sql`
    UPDATE "outbox"
    SET "attempts" = ${outcome.attempts},
        "next_attempt_at" = now() + (${outcome.retryDelayMs} * interval '1 millisecond'),
        "last_error" = ${lastError},
        "updated_at" = now()
    WHERE "event_id" = ${eventId} AND "state" = 'pending'
  `);
}
