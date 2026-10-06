import { listPrerequisitesQuery } from "../repository";
import { requireActiveProject } from "../require-active-project";

async function listPrerequisites(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return listPrerequisitesQuery(projectId);
}

export default listPrerequisites;
