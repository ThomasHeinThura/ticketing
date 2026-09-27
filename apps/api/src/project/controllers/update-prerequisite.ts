import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { prerequisiteTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type UpdatePrerequisiteInput = {
  title?: string;
  ownerSide?: "us" | "customer" | "both";
  dueDate?: Date | null;
  isBlocking?: boolean;
  /** `true` stamps `completedAt` to now; `false` clears it. Omitted leaves it untouched. */
  completed?: boolean;
};

async function updatePrerequisite(
  projectId: string,
  prerequisiteId: string,
  workspaceId: string,
  input: UpdatePrerequisiteInput,
) {
  await requireActiveProject(projectId, workspaceId);

  const [updated] = await db
    .update(prerequisiteTable)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.ownerSide !== undefined ? { ownerSide: input.ownerSide } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.isBlocking !== undefined
        ? { isBlocking: input.isBlocking }
        : {}),
      ...(input.completed !== undefined
        ? { completedAt: input.completed ? new Date() : null }
        : {}),
    })
    .where(
      and(
        eq(prerequisiteTable.id, prerequisiteId),
        eq(prerequisiteTable.projectId, projectId),
      ),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Prerequisite not found" });
  }

  return updated;
}

export default updatePrerequisite;
