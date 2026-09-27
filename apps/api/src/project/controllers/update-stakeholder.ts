import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { stakeholderTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type UpdateStakeholderInput = {
  role?: string;
  escalationOrder?: number;
  escalationWaitMinutes?: number;
};

async function updateStakeholder(
  projectId: string,
  stakeholderId: string,
  workspaceId: string,
  input: UpdateStakeholderInput,
) {
  await requireActiveProject(projectId, workspaceId);

  const [updated] = await db
    .update(stakeholderTable)
    .set({
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.escalationOrder !== undefined
        ? { escalationOrder: input.escalationOrder }
        : {}),
      ...(input.escalationWaitMinutes !== undefined
        ? { escalationWaitMinutes: input.escalationWaitMinutes }
        : {}),
    })
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

export default updateStakeholder;
