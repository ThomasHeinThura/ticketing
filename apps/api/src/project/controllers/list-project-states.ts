import { and, asc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import {
  projectTable,
  stateTable,
  stateTemplateTable,
} from "../../database/schema";

async function listProjectStates(projectId: string) {
  const rows = await db
    .select({
      id: stateTable.id,
      stateTemplateId: stateTable.stateTemplateId,
      name: stateTemplateTable.name,
      group: stateTemplateTable.group,
      position: stateTable.position,
      isDefault: stateTable.isDefault,
    })
    .from(stateTable)
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .innerJoin(projectTable, eq(projectTable.id, stateTable.projectId))
    .where(
      and(
        eq(stateTable.projectId, projectId),
        isNull(stateTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .orderBy(asc(stateTable.position), asc(stateTable.id));
  return rows.map((row) => ({
    ...row,
    group: row.group as
      | "backlog"
      | "unstarted"
      | "started"
      | "completed"
      | "cancelled",
  }));
}

export default listProjectStates;
