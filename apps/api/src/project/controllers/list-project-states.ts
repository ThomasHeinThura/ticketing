import { and, asc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  stateTable,
  stateTemplateTable,
} from "../../database/schema";

async function listProjectStates(projectId: string, workspaceId: string) {
  // #187: a soft-deleted project is treated as gone everywhere in ordinary use, so it is a
  // 404 here rather than an empty list that would read as "a project with no states".
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project) {
    throw new HTTPException(404, { message: "Project not found" });
  }

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
