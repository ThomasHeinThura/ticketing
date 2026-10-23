import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import {
  hasDenseRankPositions,
  lockRankPartition,
  rebalancePositionPartition,
} from "../../scheduler/position-rebalance";
import { assertProjectStillLive } from "../assert-work-item-live";

// Fractional rank is last-write-wins (WI-7/11); every persisted position change bumps
// version. Dense partitions trigger the five-minute leased on-demand repair (WI-12).
// No rank activity/event is invented. Reach/capability remain enforced by the route.

export type RankWorkItemInput = {
  beforeId?: string | null;
  afterId?: string | null;
};

export type RankedWorkItem = {
  key: string;
  position: string;
  version: number;
};

export async function rankWorkItem(
  key: string,
  workspaceId: string,
  input: RankWorkItemInput,
): Promise<RankedWorkItem> {
  if (!input.beforeId && !input.afterId) {
    throw new HTTPException(400, {
      message: "At least one of beforeId or afterId is required",
    });
  }

  const result = await db.transaction(async (tx) => {
    const [anchor] = await tx
      .select({
        projectId: workItemTable.projectId,
        stateId: workItemTable.stateId,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!anchor)
      throw new HTTPException(404, { message: "Work item not found" });
    const partition = { workspaceId, ...anchor };
    await lockRankPartition(tx, partition);
    const [target] = await tx
      .select()
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, key),
          eq(workItemTable.workspaceId, workspaceId),
        ),
      )
      .for("update");

    if (!target || target.archivedAt || target.deletedAt) {
      throw new HTTPException(404, { message: "Work item not found" });
    }
    if (
      target.projectId !== anchor.projectId ||
      target.stateId !== anchor.stateId
    )
      throw new HTTPException(409, {
        message: "Work item changed state; retry ranking",
      });
    await assertProjectStillLive(tx, target.projectId);

    // Neighbours must belong to the SAME rank partition (`project_id`, `state_id`) as
    // the item being moved -- an id from another project/state/workspace is rejected as
    // a plain 400 rather than silently accepted and ranked against the wrong list.
    const neighbourIds = [input.beforeId, input.afterId].filter(
      (id): id is string => typeof id === "string",
    );
    const neighbours =
      neighbourIds.length > 0
        ? await tx
            .select({
              id: workItemTable.id,
              position: workItemTable.position,
            })
            .from(workItemTable)
            .where(
              and(
                inArray(workItemTable.id, neighbourIds),
                eq(workItemTable.workspaceId, workspaceId),
                eq(workItemTable.projectId, target.projectId),
                eq(workItemTable.stateId, target.stateId),
                isNull(workItemTable.deletedAt),
                isNull(workItemTable.archivedAt),
              ),
            )
        : [];
    const byId = new Map(neighbours.map((row) => [row.id, row.position]));

    for (const id of neighbourIds) {
      if (!byId.has(id)) {
        throw new HTTPException(400, {
          message: `${id} is not in the same project/state as ${key} -- it cannot be used to rank against`,
        });
      }
    }

    if (
      neighbourIds.includes(target.id) ||
      (input.beforeId && input.beforeId === input.afterId)
    )
      throw new HTTPException(400, {
        message:
          "Rank neighbours must be distinct from the target and each other",
      });
    const beforePosition = input.beforeId
      ? byId.get(input.beforeId)
      : undefined;
    const afterPosition = input.afterId ? byId.get(input.afterId) : undefined;
    const newPosition =
      beforePosition !== undefined && afterPosition !== undefined
        ? sql`(${beforePosition}::numeric + ${afterPosition}::numeric) / 2`
        : beforePosition !== undefined
          ? sql`${beforePosition}::numeric + 1`
          : sql`${afterPosition}::numeric - 1`;

    const computed = await tx.execute<{
      position: string | null;
      ordered: boolean;
    }>(sql`
      WITH raw_position AS (SELECT (${newPosition})::numeric AS value),
      candidate AS (SELECT CASE WHEN value BETWEEN -9999999999.9999999999::numeric AND 9999999999.9999999999::numeric
        THEN value::numeric(20,10) END AS position FROM raw_position)
      SELECT position::text, position IS NOT NULL AND ${beforePosition !== undefined ? sql`position > ${beforePosition}::numeric` : sql`true`}
        AND ${afterPosition !== undefined ? sql`position < ${afterPosition}::numeric` : sql`true`} AS ordered FROM candidate
    `);
    const position = computed.rows[0];
    // Decimal rounding can exhaust a midpoint before a busy/leased repair can run.
    // Commit no move in that case, attempt the repair, and require a refreshed retry.
    if (!position?.ordered || position.position === null)
      return {
        updated: null,
        partition,
        dense: await hasDenseRankPositions(tx, partition),
      };

    const [updated] = await tx
      .update(workItemTable)
      .set({
        position: position.position,
        version: sql`${workItemTable.version} + 1`,
      })
      .where(eq(workItemTable.id, target.id))
      .returning({
        key: workItemTable.key,
        position: workItemTable.position,
        version: workItemTable.version,
      });

    if (!updated) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    return {
      updated,
      partition,
      dense: await hasDenseRankPositions(tx, partition),
    };
  });
  if (result.dense) await rebalancePositionPartition(result.partition);
  if (!result.updated)
    throw new HTTPException(409, {
      message:
        "No representable position between these neighbours; refresh and retry ranking",
    });
  // A successful repair may move the target and bump its version again. Return the
  // real post-repair value rather than the pre-repair transaction's stale DTO.
  const [current] = await db
    .select({
      key: workItemTable.key,
      position: workItemTable.position,
      version: workItemTable.version,
    })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
      ),
    );
  if (!current)
    throw new HTTPException(404, { message: "Work item not found" });
  return current;
}

export default rankWorkItem;
