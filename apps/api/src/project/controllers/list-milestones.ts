import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { milestoneTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function listMilestones(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return db
    .select()
    .from(milestoneTable)
    .where(eq(milestoneTable.projectId, projectId))
    .orderBy(asc(milestoneTable.date));
}

export default listMilestones;
