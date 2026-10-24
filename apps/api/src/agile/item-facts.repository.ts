import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { Executor } from "../database/executor";
import {
  stateTable,
  stateTemplateTable,
  workItemTable,
} from "../database/schema";
import { estimatePointTable } from "../database/schema-p5-agile";
import type { StateGroup } from "./logic";

export type ItemFact = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  workspaceId: string;
  cycleId: string | null;
  moduleId: string | null;
  estimatePointId: string | null;
  weight: number | null;
  group: StateGroup;
  resolvedAt: Date | null;
};

const GROUPS = new Set([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
]);

/** Live (not deleted, not archived) work items with their state group and estimate weight. */
export async function loadItemFacts(
  executor: Executor,
  where: SQL,
  options: { includeArchived?: boolean } = {},
): Promise<ItemFact[]> {
  const rows = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      projectId: workItemTable.projectId,
      workspaceId: workItemTable.workspaceId,
      cycleId: workItemTable.cycleId,
      moduleId: workItemTable.moduleId,
      estimatePointId: workItemTable.estimatePointId,
      weight: estimatePointTable.weight,
      group: stateTemplateTable.group,
      resolvedAt: workItemTable.resolvedAt,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .leftJoin(
      estimatePointTable,
      eq(estimatePointTable.id, workItemTable.estimatePointId),
    )
    .where(
      and(
        where,
        isNull(workItemTable.deletedAt),
        options.includeArchived ? undefined : isNull(workItemTable.archivedAt),
      ),
    );
  return rows.map((row) => ({
    ...row,
    weight: row.weight === null ? null : Number(row.weight),
    group: (GROUPS.has(row.group) ? row.group : "backlog") as StateGroup,
  }));
}

export function itemsByKeys(
  executor: Executor,
  projectId: string,
  keys: string[],
) {
  return loadItemFacts(
    executor,
    and(
      eq(workItemTable.projectId, projectId),
      inArray(workItemTable.key, keys),
    ) as SQL,
  );
}

/**
 * Lock the project's items with these keys `FOR UPDATE` in id order. The agile lock order is
 * ITEM rows (id order) -> CYCLE rows (id order), the order the cross-project move already takes
 * (`recordCycleRemovalsOnMove`), so an add, a remove, a delete and a move never wait on each
 * other in a cycle, and two adds of one item to different cycles serialise on the item.
 */
export async function lockItemsByKeys(
  tx: Executor,
  projectId: string,
  keys: string[],
) {
  if (keys.length === 0) return;
  await tx
    .select({ id: workItemTable.id })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.projectId, projectId),
        inArray(workItemTable.key, keys),
      ),
    )
    .orderBy(asc(workItemTable.id))
    .for("update");
}

/** Lock every item currently pointing at a cycle (id order); see `lockItemsByKeys`. */
export async function lockItemsOfCycle(tx: Executor, cycleId: string) {
  await tx
    .select({ id: workItemTable.id })
    .from(workItemTable)
    .where(eq(workItemTable.cycleId, cycleId))
    .orderBy(asc(workItemTable.id))
    .for("update");
}
