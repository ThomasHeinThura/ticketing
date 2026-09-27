import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { stakeholderTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function listStakeholders(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return db
    .select()
    .from(stakeholderTable)
    .where(eq(stakeholderTable.projectId, projectId))
    .orderBy(asc(stakeholderTable.escalationOrder));
}

export default listStakeholders;
