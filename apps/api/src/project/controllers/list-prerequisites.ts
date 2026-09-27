import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { prerequisiteTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function listPrerequisites(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return db
    .select()
    .from(prerequisiteTable)
    .where(eq(prerequisiteTable.projectId, projectId))
    .orderBy(asc(prerequisiteTable.createdAt));
}

export default listPrerequisites;
