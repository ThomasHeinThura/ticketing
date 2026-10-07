import { listStakeholdersQuery } from "../repository";
import { requireActiveProject } from "../require-active-project";

async function listStakeholders(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return listStakeholdersQuery(projectId);
}

export default listStakeholders;
