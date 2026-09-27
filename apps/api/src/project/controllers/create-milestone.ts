import db from "../../database";
import { milestoneTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type CreateMilestoneInput = {
  name: string;
  date: Date;
};

async function createMilestone(
  projectId: string,
  workspaceId: string,
  input: CreateMilestoneInput,
) {
  await requireActiveProject(projectId, workspaceId);

  const [created] = await db
    .insert(milestoneTable)
    .values({ projectId, name: input.name, date: input.date })
    .returning();

  return created;
}

export default createMilestone;
