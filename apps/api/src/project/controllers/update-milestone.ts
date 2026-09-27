import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { milestoneTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type UpdateMilestoneInput = {
  name?: string;
  date?: Date;
  /** `true` stamps `reachedAt` to now; `false` clears it. Omitted leaves it untouched. */
  reached?: boolean;
};

async function updateMilestone(
  projectId: string,
  milestoneId: string,
  workspaceId: string,
  input: UpdateMilestoneInput,
) {
  await requireActiveProject(projectId, workspaceId);

  const [updated] = await db
    .update(milestoneTable)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.reached !== undefined
        ? { reachedAt: input.reached ? new Date() : null }
        : {}),
    })
    .where(
      and(
        eq(milestoneTable.id, milestoneId),
        eq(milestoneTable.projectId, projectId),
      ),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Milestone not found" });
  }

  return updated;
}

export default updateMilestone;
