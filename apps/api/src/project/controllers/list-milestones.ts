import { listMilestonesQuery } from "../repository";
import { requireActiveProject } from "../require-active-project";

async function listMilestones(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return listMilestonesQuery(projectId);
}

export default listMilestones;
