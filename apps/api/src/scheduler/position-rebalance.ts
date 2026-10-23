import { and, asc, eq, isNull, sql } from "drizzle-orm";
import db from "../database";
import type { Transaction } from "../database/executor";
import { workItemTable } from "../database/schema";
import { assertProjectStillLive } from "../work-item/assert-work-item-live";
import { withJobLease } from "./leader-lock";

export type RankPartition = {
  workspaceId: string;
  projectId: string;
  stateId: string;
};
export type PositionRebalanceOutcome = {
  status:
    | "rebalanced"
    | "healthy"
    | "busy"
    | "leased"
    | "unavailable"
    | "bounded";
  changed: number;
};

export function rankPartitionPredicate(partition: RankPartition) {
  return and(
    eq(workItemTable.workspaceId, partition.workspaceId),
    eq(workItemTable.projectId, partition.projectId),
    eq(workItemTable.stateId, partition.stateId),
    isNull(workItemTable.deletedAt),
    isNull(workItemTable.archivedAt),
  );
}

/** Shared by every rank write and the worker, before any work-item row locks. */
export async function lockRankPartition(
  tx: Transaction,
  partition: RankPartition,
  wait = true,
): Promise<boolean> {
  if (!wait) {
    const result = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${JSON.stringify(["work-item-position", partition.workspaceId, partition.projectId, partition.stateId])}, 0)) AS acquired`,
    );
    return result.rows[0]?.acquired === true;
  }
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["work-item-position", partition.workspaceId, partition.projectId, partition.stateId])}, 0))`,
  );
  return true;
}

export async function hasDenseRankPositions(
  tx: Transaction,
  partition: RankPartition,
): Promise<boolean> {
  const result = await tx.execute<{ dense: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM (
        SELECT position - lag(position) OVER (ORDER BY position, id) AS gap
        FROM ${workItemTable} WHERE ${rankPartitionPredicate(partition)}
      ) positions WHERE gap < 0.000001::numeric
    ) AS dense
  `);
  return result.rows[0]?.dense === true;
}

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: string; cause?: unknown };
  return (
    candidate.code ??
    (candidate.cause !== error ? postgresCode(candidate.cause) : undefined)
  );
}

/** The lease avoids duplicate work; the transaction lock remains authoritative after expiry. */
export async function rebalancePositionPartition(
  partition: RankPartition,
  options: { maxRows?: number } = {},
): Promise<PositionRebalanceOutcome> {
  if (
    options.maxRows !== undefined &&
    (!Number.isInteger(options.maxRows) ||
      options.maxRows < 1 ||
      options.maxRows > 50000)
  )
    throw new Error("Partition row bound must be between 1 and 50000");
  try {
    return await withJobLease<PositionRebalanceOutcome>(
      "position-rebalance",
      () =>
        db.transaction(async (tx) => {
          if (!(await lockRankPartition(tx, partition, false)))
            return { status: "busy", changed: 0 };
          // NOWAIT prevents a lock cycle with transition's parent UPDATE → child SHARE
          // or hierarchy writers. A busy attempt rolls back every row lock and can recover.
          const rows = await tx
            .select({ id: workItemTable.id, position: workItemTable.position })
            .from(workItemTable)
            .where(rankPartitionPredicate(partition))
            .orderBy(asc(workItemTable.position), asc(workItemTable.id))
            .limit(
              options.maxRows !== undefined ? options.maxRows + 1 : 2147483647,
            )
            .for("update", { noWait: true });
          if (options.maxRows !== undefined && rows.length > options.maxRows)
            return { status: "bounded", changed: 0 };
          if (!rows.length) return { status: "healthy", changed: 0 };
          await assertProjectStillLive(tx, partition.projectId);
          if (!(await hasDenseRankPositions(tx, partition)))
            return { status: "healthy", changed: 0 };
          // One set-based write, restricted to exactly the rows already locked.
          // Version changes only where the persisted numeric position changes.
          const updated = await tx.execute(sql`
            WITH desired AS (
              SELECT id, row_number() OVER (ORDER BY position, id)::numeric AS position
              FROM ${workItemTable} WHERE id = ANY(${sql.param(rows.map((row) => row.id))}::text[])
            )
            UPDATE ${workItemTable} SET position = desired.position, version = work_item.version + 1
            FROM desired WHERE work_item.id = desired.id AND work_item.position <> desired.position
            RETURNING work_item.id
          `);
          const changed = updated.rowCount ?? 0;
          return { status: "rebalanced", changed };
        }),
      () => ({ status: "leased", changed: 0 }),
      5 * 60 * 1000,
    );
  } catch (error) {
    if (postgresCode(error) === "55P03") return { status: "busy", changed: 0 };
    if (error instanceof Error && "status" in error && error.status === 404)
      return { status: "unavailable", changed: 0 };
    throw error;
  }
}

/** Persisted discovery supports startup/manual recovery without another user's rank. */
export async function recoverDensePositionPartitions(
  limit = 100,
  options: { scanRows?: number; maxPartitionRows?: number } = {},
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Recovery limit must be between 1 and 500");
  if (
    options.scanRows !== undefined &&
    (!Number.isInteger(options.scanRows) ||
      options.scanRows < 1 ||
      options.scanRows > 50000)
  )
    throw new Error("Recovery scan bound must be between 1 and 50000");
  const result = await db.execute<RankPartition>(sql`
    WITH sample AS (
      SELECT id, position, workspace_id AS "workspaceId", project_id AS "projectId", state_id AS "stateId"
      FROM ${workItemTable} WHERE deleted_at IS NULL AND archived_at IS NULL
        AND EXISTS (SELECT 1 FROM project live_project WHERE live_project.id = work_item.project_id
          AND live_project.workspace_id = work_item.workspace_id AND live_project.deleted_at IS NULL AND live_project.archived_at IS NULL)
      ORDER BY id ${options.scanRows !== undefined ? sql`LIMIT ${options.scanRows}` : sql``}
    ), positions AS (
      SELECT "workspaceId", "projectId", "stateId",
        position - lag(position) OVER (PARTITION BY "workspaceId", "projectId", "stateId" ORDER BY position, id) AS gap
      FROM sample
    )
    SELECT DISTINCT "workspaceId", "projectId", "stateId" FROM positions
    WHERE gap < 0.000001::numeric ORDER BY "workspaceId", "projectId", "stateId" LIMIT ${limit}
  `);
  const outcomes = [];
  for (const partition of result.rows)
    outcomes.push({
      partition,
      outcome: await rebalancePositionPartition(partition, {
        maxRows: options.maxPartitionRows,
      }),
    });
  return outcomes;
}
