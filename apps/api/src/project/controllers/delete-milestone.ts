import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { milestoneTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function deleteMilestone(
  projectId: string,
  milestoneId: string,
  workspaceId: string,
) {
  await requireActiveProject(projectId, workspaceId);

  const [deleted] = await db
    .delete(milestoneTable)
    .where(
      and(
        eq(milestoneTable.id, milestoneId),
        eq(milestoneTable.projectId, projectId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new HTTPException(404, { message: "Milestone not found" });
  }

  return deleted;
}

export default deleteMilestone;
