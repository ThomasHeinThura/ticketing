import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { personTable, stakeholderTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type AddStakeholderInput = {
  personId: string;
  role: string;
  escalationOrder: number;
  escalationWaitMinutes?: number;
};

async function addStakeholder(
  projectId: string,
  workspaceId: string,
  input: AddStakeholderInput,
) {
  await requireActiveProject(projectId, workspaceId);

  const [person] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.id, input.personId))
    .limit(1);

  if (!person) {
    throw new HTTPException(404, { message: "Person not found" });
  }

  const [created] = await db
    .insert(stakeholderTable)
    .values({
      projectId,
      personId: input.personId,
      role: input.role,
      escalationOrder: input.escalationOrder,
      escalationWaitMinutes: input.escalationWaitMinutes ?? 0,
    })
    .returning();

  return created;
}

export default addStakeholder;
