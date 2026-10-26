import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import db, { schema } from "../../database";
import type { SavedViewTransaction } from "../../view/repository";
import { lockSavedViewByIdInTransaction } from "../../view/repository";

export type PairedSavedView = typeof schema.savedViewTable.$inferSelect & {
  queuePairId: string;
  queueVersion: number;
};

export type SavedViewQueuePair = {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  visibility: "private" | "team";
  sharedWithTeamId: string | null;
  submissionView: PairedSavedView;
  workItemView: PairedSavedView;
};

function isPairedSavedView(
  row: typeof schema.savedViewTable.$inferSelect,
): row is PairedSavedView {
  return row.queuePairId !== null && row.queueVersion !== null;
}

export function queuePairFromRows(
  rows: readonly (typeof schema.savedViewTable.$inferSelect)[],
): SavedViewQueuePair | null {
  if (rows.length !== 2) return null;
  if (!rows.every(isPairedSavedView)) return null;
  const pairedRows = rows as PairedSavedView[];
  const submissionView = pairedRows.find(
    (row) => (row.query as { entity?: unknown })?.entity === "submission",
  );
  const workItemView = pairedRows.find(
    (row) => (row.query as { entity?: unknown })?.entity === "work_item",
  );
  const first = pairedRows[0];
  if (
    !submissionView ||
    !workItemView ||
    !first ||
    (first.visibility !== "private" && first.visibility !== "team") ||
    rows.some(
      (row) =>
        row.queuePairId !== first.queuePairId ||
        row.workspaceId !== first.workspaceId ||
        row.createdBy !== first.createdBy ||
        row.name !== first.name ||
        row.visibility !== first.visibility ||
        row.sharedWithTeamId !== first.sharedWithTeamId ||
        row.scope !== "workspace" ||
        row.scopeId !== first.workspaceId ||
        row.layout !== "list",
    )
  ) {
    return null;
  }
  return {
    id: first.queuePairId,
    workspaceId: first.workspaceId,
    createdBy: first.createdBy,
    name: first.name,
    visibility: first.visibility,
    sharedWithTeamId: first.sharedWithTeamId,
    submissionView,
    workItemView,
  };
}

export async function listReachableQueuePairs(input: {
  workspaceId: string;
  personId: string;
  userId: string;
}) {
  const teams = await db
    .select({ id: schema.teamMemberTable.teamId })
    .from(schema.teamMemberTable)
    .innerJoin(
      schema.teamTable,
      eq(schema.teamTable.id, schema.teamMemberTable.teamId),
    )
    .where(
      and(
        eq(schema.teamMemberTable.userId, input.userId),
        eq(schema.teamTable.workspaceId, input.workspaceId),
      ),
    );
  const teamIds = teams.map((team) => team.id);
  const visibility = or(
    and(
      eq(schema.savedViewTable.visibility, "private"),
      eq(schema.savedViewTable.createdBy, input.personId),
    ),
    teamIds.length > 0
      ? and(
          eq(schema.savedViewTable.visibility, "team"),
          inArray(schema.savedViewTable.sharedWithTeamId, teamIds),
        )
      : undefined,
  );
  const rows = await db
    .select()
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.workspaceId, input.workspaceId),
        isNotNull(schema.savedViewTable.queuePairId),
        visibility,
      ),
    )
    .orderBy(schema.savedViewTable.name, schema.savedViewTable.queuePairId);
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.queuePairId) continue;
    const group = groups.get(row.queuePairId) ?? [];
    group.push(row);
    groups.set(row.queuePairId, group);
  }
  return [...groups.values()]
    .map(queuePairFromRows)
    .filter((pair): pair is SavedViewQueuePair => pair !== null);
}

export async function findQueuePairRows(
  workspaceId: string,
  queuePairId: string,
) {
  return db
    .select()
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.queuePairId, queuePairId),
      ),
    )
    .orderBy(schema.savedViewTable.id);
}

export async function lockQueuePairRows(
  tx: SavedViewTransaction,
  workspaceId: string,
  queuePairId: string,
) {
  const rows = await tx
    .select({ id: schema.savedViewTable.id })
    .from(schema.savedViewTable)
    .where(
      and(
        eq(schema.savedViewTable.workspaceId, workspaceId),
        eq(schema.savedViewTable.queuePairId, queuePairId),
      ),
    )
    .orderBy(schema.savedViewTable.id);
  const locked = [];
  for (const row of rows) {
    locked.push(await lockSavedViewByIdInTransaction(tx, row.id));
  }
  return locked.filter(
    (row): row is NonNullable<typeof row> => row !== undefined,
  );
}
