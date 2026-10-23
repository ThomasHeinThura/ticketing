import { sql } from "drizzle-orm";
import type { Executor } from "../database/executor";

/**
 * SQL for `audit-purge` (`background-jobs.md`, `AU-3`, `AU-6`, data-model.md §11).
 *
 * Two database objects this job depends on (migrations 0131/0132): the `audit_chain_anchor`
 * table and the `audit_log_purge_prefix(bigint)` SECURITY DEFINER function. The API role holds
 * no DELETE on `audit_log` and no INSERT on `audit_chain_anchor`; the function alone enforces
 * the retention floor and writes the anchor. Until both exist,
 * {@link auditPurgePrerequisitesPresent} reports false and the job deletes nothing.
 */

/** Open legal hold on the row's organisation (direct or via its workspace) or on its actor. */
const AUDIT_ROW_UNDER_OPEN_HOLD = sql`
  EXISTS (
    SELECT 1
    FROM "legal_hold" lh
    WHERE lh."lifted_at" IS NULL
      AND (
        (lh."scope" = 'organisation' AND (
          lh."scope_id" = a."organisation_id"
          OR lh."scope_id" = (
            SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = a."workspace_id"
          )
          OR lh."scope_id" IN (
            SELECT p."organisation_id" FROM "person" p
            WHERE p."id" = a."actor_id" OR p."user_id" = a."actor_id"
          )
        ))
        OR (lh."scope" = 'person' AND (
          lh."scope_id" = a."actor_id"
          OR lh."scope_id" IN (
            SELECT p."id" FROM "person" p WHERE p."user_id" = a."actor_id"
          )
        ))
      )
  )
`;

export async function auditPurgePrerequisitesPresent(
  executor: Executor,
): Promise<{ anchorTable: boolean; purgeFunction: boolean }> {
  const result = await executor.execute<{
    anchor_table: boolean;
    purge_function: boolean;
  }>(sql`
    SELECT
      to_regclass('public.audit_chain_anchor') IS NOT NULL AS anchor_table,
      to_regprocedure('public.audit_log_purge_prefix(bigint)') IS NOT NULL AS purge_function
  `);
  const row = result.rows[0];
  return {
    anchorTable: row?.anchor_table === true,
    purgeFunction: row?.purge_function === true,
  };
}

/** Fences hold placement for the rest of the transaction (same fence `attachment-gc` uses). */
export async function fenceLegalHolds(executor: Executor): Promise<void> {
  await executor.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
}

export type AuditPurgeBounds = {
  headSeq: bigint | null;
  firstBlockedSeq: bigint | null;
  capSeq: bigint | null;
};

/**
 * The three inputs of the contiguous-prefix plan: the chain head, the first row that is
 * either inside retention or under an open hold, and the seq just past the per-run cap.
 */
export async function readAuditPurgeBounds(
  executor: Executor,
  retention: string,
  maxRows: number,
): Promise<AuditPurgeBounds> {
  const result = await executor.execute<{
    head_seq: string | null;
    first_blocked_seq: string | null;
    cap_seq: string | null;
  }>(sql`
    SELECT
      (SELECT max(seq) FROM audit_log)::text AS head_seq,
      (
        SELECT min(a.seq) FROM audit_log a
        WHERE a."created_at" > now() - ${retention}::interval
          OR ${AUDIT_ROW_UNDER_OPEN_HOLD}
      )::text AS first_blocked_seq,
      (
        SELECT seq FROM audit_log ORDER BY seq ASC OFFSET ${maxRows} LIMIT 1
      )::text AS cap_seq
  `);
  const row = result.rows[0];
  const big = (value: string | null | undefined) =>
    value === null || value === undefined ? null : BigInt(value);
  return {
    headSeq: big(row?.head_seq),
    firstBlockedSeq: big(row?.first_blocked_seq),
    capSeq: big(row?.cap_seq),
  };
}

/**
 * The inclusive cut-off of the deletable prefix: the highest `seq` below `belowSeq`, or `null`
 * when there is none. This is the ONLY input the application supplies to the purge. The anchor
 * (count, hashes, first/last `created_at`) is derived and written inside the database function.
 */
export async function readAuditPurgeCutoff(
  executor: Executor,
  belowSeq: bigint,
): Promise<bigint | null> {
  const result = await executor.execute<{ through_seq: string | null }>(sql`
    SELECT max(seq)::text AS through_seq FROM audit_log WHERE seq < ${belowSeq.toString()}::bigint
  `);
  const value = result.rows[0]?.through_seq;
  return value === null || value === undefined ? null : BigInt(value);
}

export type AuditPurgeResult = {
  anchorId: string;
  purgedCount: number;
  firstPurgedCreatedAt: string;
  purgedThroughAt: string;
};

/**
 * Deletes `audit_log` rows with `seq <= throughSeq` through the owner-defined
 * `audit_log_purge_prefix(bigint)` (migration 0132). The function enforces the retention floor,
 * the hold rule and the head rule, computes and inserts the anchor itself (the application role
 * holds no INSERT on `audit_chain_anchor`), deletes, and returns what it anchored.
 */
export async function purgeAuditPrefix(
  executor: Executor,
  throughSeq: bigint,
): Promise<AuditPurgeResult> {
  const result = await executor.execute<{
    anchor_id: string;
    purged_count: string | number;
    first_created_at: string;
    through_at: string;
  }>(sql`
    SELECT
      out_anchor_id AS anchor_id,
      out_purged_count AS purged_count,
      to_char(out_first_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_created_at,
      to_char(out_through_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS through_at
    FROM audit_log_purge_prefix(${throughSeq.toString()}::bigint)
  `);
  const row = result.rows[0];
  if (!row) throw new Error("audit_log_purge_prefix returned no anchor");
  return {
    anchorId: row.anchor_id,
    purgedCount: Number(row.purged_count),
    firstPurgedCreatedAt: row.first_created_at,
    purgedThroughAt: row.through_at,
  };
}

export type AuditChainAnchorRow = {
  id: string;
  last_purged_row_hash: string;
  next_row_hash: string | null;
};

/** The newest anchor, or `undefined` when none exists or the table is not migrated yet. */
export async function findNewestAuditChainAnchor(
  executor: Executor,
): Promise<AuditChainAnchorRow | undefined> {
  const present = await executor.execute<{ present: boolean }>(
    sql`SELECT to_regclass('public.audit_chain_anchor') IS NOT NULL AS present`,
  );
  if (present.rows[0]?.present !== true) return undefined;
  const result = await executor.execute<AuditChainAnchorRow>(sql`
    SELECT "id", "last_purged_row_hash", "next_row_hash"
    FROM audit_chain_anchor
    ORDER BY "created_at" DESC, "purged_through_at" DESC, "id" DESC
    LIMIT 1
  `);
  return result.rows[0];
}
