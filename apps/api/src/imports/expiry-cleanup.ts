import { type SQL, sql } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { pendingActionTable } from "../database/schema";
import { importChunkTable, importRunTable } from "../database/schema-imports";
import { lockPendingActionLifecycle } from "../pending-action/lifecycle-invalidation.repository";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

const FIXED_REJECTION_CODES = [
  "unsupported_authorship_or_timestamp",
  "invalid_target_record",
  "target_not_available",
  "target_permission_denied",
  "linked_target_unavailable",
  "assignment_update_requires_manual_action",
  "target_project_purged",
] as const;
const TERMINAL_PENDING_ACTION_STATES = [
  "executed",
  "denied",
  "cancelled",
  "expired",
  "invalidated",
  "failed",
] as const;

function boundedBatchSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(value)));
}

function terminalPendingActionStatesSql(): SQL {
  return sql.join(
    TERMINAL_PENDING_ACTION_STATES.map((state) => sql`${state}`),
    sql`, `,
  );
}

function scrubExpiredChunkRows(): SQL {
  const rejectionCodes = sql.join(
    FIXED_REJECTION_CODES.map((code) => sql`${code}`),
    sql`, `,
  );
  return sql`
    UPDATE ${importChunkTable} AS chunk
    SET input_payload = NULL,
        report = jsonb_set(
          jsonb_set(chunk.report, '{rows}', '[]'::jsonb, true),
          '{rejectionCodes}',
          CASE
            WHEN jsonb_typeof(chunk.report -> 'rejectionCodes') = 'object'
              THEN chunk.report -> 'rejectionCodes'
            ELSE '{}'::jsonb
          END || (
            SELECT COALESCE(jsonb_object_agg(code_counts.code, to_jsonb(code_counts.total)), '{}'::jsonb)
            FROM (
              SELECT entry.value ->> 'code' AS code, count(*)::integer AS total
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(chunk.report -> 'rows') = 'array'
                    THEN chunk.report -> 'rows'
                  ELSE '[]'::jsonb
                END
              ) AS entry(value)
              WHERE entry.value ->> 'code' IN (${rejectionCodes})
              GROUP BY entry.value ->> 'code'
            ) AS code_counts
          ),
          true
        )
    FROM locked_chunks AS locked
    WHERE chunk.id = locked.id
    RETURNING chunk.id
  `;
}

/**
 * Build one bounded cleanup statement. It locks import runs before their chunks, matching
 * preview/commit/approval lock order. Pending approvals are never eligible: their staged
 * payload is required by the approval executor.
 */
export function expiredImportChunkCleanupQuery(
  batchSize = DEFAULT_BATCH_SIZE,
): SQL {
  const limit = boundedBatchSize(batchSize);
  const terminalStates = terminalPendingActionStatesSql();

  return sql`
    WITH candidates AS MATERIALIZED (
      SELECT chunk.id, chunk.import_run_id, chunk.expires_at
      FROM ${importChunkTable} AS chunk
      WHERE chunk.expires_at <= clock_timestamp()
        AND chunk.state IN ('previewed', 'rejected', 'failed')
        AND (
          chunk.pending_action_id IS NULL
          OR EXISTS (
            SELECT 1 FROM ${pendingActionTable} AS action
            WHERE action.id = chunk.pending_action_id
              AND action.state IN (${terminalStates})
          )
          OR NOT EXISTS (
            SELECT 1 FROM ${pendingActionTable} AS action
            WHERE action.id = chunk.pending_action_id
          )
        )
        AND (
          chunk.input_payload IS NOT NULL
          OR (
            jsonb_array_length(
              CASE
                WHEN jsonb_typeof(chunk.report -> 'rows') = 'array'
                  THEN chunk.report -> 'rows'
                ELSE '[]'::jsonb
              END
            ) > 0
          )
        )
      ORDER BY chunk.expires_at, chunk.import_run_id, chunk.id
      LIMIT ${limit}
    ),
    candidate_runs AS MATERIALIZED (
      SELECT DISTINCT candidate.import_run_id
      FROM candidates AS candidate
    ),
    locked_runs AS MATERIALIZED (
      SELECT run.id
      FROM ${importRunTable} AS run
      INNER JOIN candidate_runs AS candidate
        ON candidate.import_run_id = run.id
      ORDER BY run.id
      FOR UPDATE OF run SKIP LOCKED
    ),
    locked_chunks AS MATERIALIZED (
      SELECT chunk.id
      FROM ${importChunkTable} AS chunk
      INNER JOIN locked_runs AS run ON run.id = chunk.import_run_id
      INNER JOIN candidates AS candidate ON candidate.id = chunk.id
      WHERE chunk.expires_at <= clock_timestamp()
        AND chunk.state IN ('previewed', 'rejected', 'failed')
        AND (
          chunk.pending_action_id IS NULL
          OR EXISTS (
            SELECT 1 FROM ${pendingActionTable} AS action
            WHERE action.id = chunk.pending_action_id
              AND action.state IN (${terminalStates})
          )
          OR NOT EXISTS (
            SELECT 1 FROM ${pendingActionTable} AS action
            WHERE action.id = chunk.pending_action_id
          )
        )
        AND (
          chunk.input_payload IS NOT NULL
          OR (
            jsonb_array_length(
              CASE
                WHEN jsonb_typeof(chunk.report -> 'rows') = 'array'
                  THEN chunk.report -> 'rows'
                ELSE '[]'::jsonb
              END
            ) > 0
          )
        )
      ORDER BY chunk.expires_at, chunk.import_run_id, chunk.id
      FOR UPDATE OF chunk SKIP LOCKED
    ),
    scrubbed AS (${scrubExpiredChunkRows()})
    SELECT id FROM scrubbed
  `;
}

/**
 * Pending chunks keep staged records until their linked approval is terminal. The executor
 * acquires the lifecycle gate before pending action → import run → chunk; cleanup follows the
 * same order. Missing/null pending-action links are scrubbed only when no live row exists.
 */
export function expiredPendingImportChunkCleanupQuery(
  batchSize = DEFAULT_BATCH_SIZE,
): SQL {
  const limit = boundedBatchSize(batchSize);
  const terminalStates = terminalPendingActionStatesSql();

  return sql`
    WITH candidates AS MATERIALIZED (
      SELECT chunk.id, chunk.import_run_id, chunk.pending_action_id, chunk.expires_at
      FROM ${importChunkTable} AS chunk
      WHERE chunk.expires_at <= clock_timestamp()
        AND chunk.state = 'pending_approval'
        AND (
          chunk.input_payload IS NOT NULL
          OR jsonb_array_length(
            CASE
              WHEN jsonb_typeof(chunk.report -> 'rows') = 'array'
                THEN chunk.report -> 'rows'
              ELSE '[]'::jsonb
            END
          ) > 0
        )
        AND (
          chunk.pending_action_id IS NULL
          OR EXISTS (
            SELECT 1 FROM ${pendingActionTable} AS action
            WHERE action.id = chunk.pending_action_id
              AND action.state IN (${terminalStates})
          )
          OR NOT EXISTS (
            SELECT 1 FROM ${pendingActionTable} AS action
            WHERE action.id = chunk.pending_action_id
          )
        )
      ORDER BY chunk.expires_at, chunk.pending_action_id, chunk.import_run_id, chunk.id
      LIMIT ${limit}
    ),
    candidate_actions AS MATERIALIZED (
      SELECT DISTINCT candidate.pending_action_id
      FROM candidates AS candidate
      WHERE candidate.pending_action_id IS NOT NULL
    ),
    locked_actions AS MATERIALIZED (
      SELECT action.id
      FROM ${pendingActionTable} AS action
      INNER JOIN candidate_actions AS candidate
        ON candidate.pending_action_id = action.id
      WHERE action.state IN (${terminalStates})
      ORDER BY action.id
      FOR UPDATE OF action SKIP LOCKED
    ),
    candidate_runs AS MATERIALIZED (
      SELECT DISTINCT candidate.import_run_id
      FROM candidates AS candidate
      WHERE candidate.pending_action_id IS NULL
        OR candidate.pending_action_id IN (SELECT id FROM locked_actions)
        OR NOT EXISTS (
          SELECT 1 FROM ${pendingActionTable} AS action
          WHERE action.id = candidate.pending_action_id
        )
    ),
    locked_runs AS MATERIALIZED (
      SELECT run.id
      FROM ${importRunTable} AS run
      INNER JOIN candidate_runs AS candidate
        ON candidate.import_run_id = run.id
      ORDER BY run.id
      FOR UPDATE OF run SKIP LOCKED
    ),
    locked_chunks AS MATERIALIZED (
      SELECT chunk.id
      FROM ${importChunkTable} AS chunk
      INNER JOIN locked_runs AS run ON run.id = chunk.import_run_id
      INNER JOIN candidates AS candidate
        ON candidate.id = chunk.id
        AND candidate.pending_action_id IS NOT DISTINCT FROM chunk.pending_action_id
      WHERE chunk.expires_at <= clock_timestamp()
        AND chunk.state = 'pending_approval'
        AND (
          chunk.pending_action_id IS NULL
          OR chunk.pending_action_id IN (SELECT id FROM locked_actions)
          OR NOT EXISTS (
            SELECT 1 FROM ${pendingActionTable} AS action
            WHERE action.id = chunk.pending_action_id
          )
        )
        AND (
          chunk.input_payload IS NOT NULL
          OR jsonb_array_length(
            CASE
              WHEN jsonb_typeof(chunk.report -> 'rows') = 'array'
                THEN chunk.report -> 'rows'
              ELSE '[]'::jsonb
            END
          ) > 0
        )
      ORDER BY chunk.expires_at, chunk.import_run_id, chunk.id
      FOR UPDATE OF chunk SKIP LOCKED
    ),
    scrubbed AS (${scrubExpiredChunkRows()})
    SELECT id FROM scrubbed
  `;
}

/** Execute inside an existing transaction; exposed for the scheduler adapter and unit tests. */
export async function scrubExpiredImportChunksInTransaction(
  tx: Executor,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<number> {
  const result = await tx.execute<{ id: string }>(
    expiredImportChunkCleanupQuery(batchSize),
  );
  return result.rows.length;
}

export async function scrubExpiredPendingImportChunksInTransaction(
  tx: Executor,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<number> {
  await lockPendingActionLifecycle(tx);
  const result = await tx.execute<{ id: string }>(
    expiredPendingImportChunkCleanupQuery(batchSize),
  );
  return result.rows.length;
}

/** Scheduler entry point. Each pass keeps its candidate selection, locks and scrub atomic. */
export async function cleanupExpiredImportChunks(
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<number> {
  // Separate transactions prevent the run → chunk pass from holding locks while the
  // approval-aware pass acquires pending_action → run → chunk locks.
  const pendingApprovalChunks = await db.transaction((tx) =>
    scrubExpiredPendingImportChunksInTransaction(tx, batchSize),
  );
  const ordinaryChunks = await db.transaction((tx) =>
    scrubExpiredImportChunksInTransaction(tx, batchSize),
  );
  return pendingApprovalChunks + ordinaryChunks;
}
