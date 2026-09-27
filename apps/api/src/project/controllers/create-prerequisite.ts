import db from "../../database";
import { prerequisiteTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type CreatePrerequisiteInput = {
  title: string;
  ownerSide: "us" | "customer" | "both";
  dueDate?: Date | null;
  isBlocking?: boolean;
};

async function createPrerequisite(
  projectId: string,
  workspaceId: string,
  input: CreatePrerequisiteInput,
) {
  await requireActiveProject(projectId, workspaceId);

  const [created] = await db
    .insert(prerequisiteTable)
    .values({
      projectId,
      title: input.title,
      ownerSide: input.ownerSide,
      dueDate: input.dueDate ?? null,
      isBlocking: input.isBlocking ?? false,
    })
    .returning();

  return created;
}

export default createPrerequisite;
