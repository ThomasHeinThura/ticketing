import { sql } from "drizzle-orm";
import type { Transaction } from "../database/executor";

/** Serialize relation graph changes before endpoint locks, including PA execution. */
export async function lockRelationGraph(
  tx: Transaction,
  workspaceId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(782019, hashtext(${workspaceId}))`,
  );
}

import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  projectTable,
  stateTable,
  stateTemplateTable,
  workItemRelationTable,
  workItemTable,
} from "../database/schema";
import { enqueueWorkItemUnblocked } from "../notification/work-item-unblocked";
import type { ActivityActorType } from "../work-item/activity";

export async function hasOpenBlockers(
  itemId: string,
  executor: Executor = db,
): Promise<boolean> {
  const rows = await executor
    .select({ id: workItemRelationTable.id })
    .from(workItemRelationTable)
    .innerJoin(
      workItemTable,
      eq(workItemTable.id, workItemRelationTable.sourceId),
    )
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        eq(workItemRelationTable.targetId, itemId),
        eq(workItemRelationTable.type, "blocks"),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        notInArray(stateTemplateTable.group, ["completed", "cancelled"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
export async function isOpenBlocker(
  tx: Transaction,
  itemId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: workItemTable.id })
    .from(workItemTable)
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        eq(workItemTable.id, itemId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        notInArray(stateTemplateTable.group, ["completed", "cancelled"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
/** Caller holds the workspace graph lock; only call after a formerly open blocker ceases. */
export async function emitUnblockedTargets(
  tx: Transaction,
  input: {
    targetIds: string[];
    formerBlockerId: string;
    actorId: string;
    actorType: ActivityActorType;
  },
) {
  const events: {
    item: {
      id: string;
      key: string;
      projectId: string;
      workspaceId: string;
      assigneeId: string | null;
    };
    event: { id: string; occurredAt: Date };
  }[] = [];
  if (!input.targetIds.length) return events;
  const items = await tx
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      projectId: workItemTable.projectId,
      workspaceId: workItemTable.workspaceId,
      assigneeId: workItemTable.assigneeId,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .where(
      and(
        inArray(workItemTable.id, [...new Set(input.targetIds)]),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    );
  for (const item of items) {
    if (await hasOpenBlockers(item.id, tx)) continue;
    const event = await enqueueWorkItemUnblocked(tx, {
      item,
      actorId: input.actorId,
      actorType: input.actorType,
      formerBlockerId: input.formerBlockerId,
    });
    events.push({ item, event });
  }
  return events;
}
export async function emitUnblockedAfterClosing(
  tx: Transaction,
  input: { blockerId: string; actorId: string; actorType: ActivityActorType },
) {
  const edges = await tx
    .select({ targetId: workItemRelationTable.targetId })
    .from(workItemRelationTable)
    .where(
      and(
        eq(workItemRelationTable.sourceId, input.blockerId),
        eq(workItemRelationTable.type, "blocks"),
      ),
    );
  return emitUnblockedTargets(tx, {
    targetIds: edges.map((row) => row.targetId),
    formerBlockerId: input.blockerId,
    actorId: input.actorId,
    actorType: input.actorType,
  });
}
