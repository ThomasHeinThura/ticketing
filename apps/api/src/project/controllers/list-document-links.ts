import { listDocumentLinksQuery } from "../repository";
import { requireActiveProject } from "../require-active-project";

async function listDocumentLinks(projectId: string, workspaceId: string) {
  await requireActiveProject(projectId, workspaceId);

  return listDocumentLinksQuery(projectId);
}

export default listDocumentLinks;
