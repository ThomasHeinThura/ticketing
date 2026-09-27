import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { stakeholderTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

/** `PR-12`: stood down, never deleted -- removes from counts and pickers, keeps history. */
async function standDownStakeholder(
  projectId: string,
  stakeholderId: string,
  workspaceId: string,
) {
  await requireActiveProject(projectId, workspaceId);

  const [updated] = await db
    .update(stakeholderTable)
    .set({ active: false })
    .where(
      and(
        eq(stakeholderTable.id, stakeholderId),
        eq(stakeholderTable.projectId, projectId),
      ),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Stakeholder not found" });
  }

  return updated;
}

export default standDownStakeholder;
