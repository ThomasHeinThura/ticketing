import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** `GET /api/projects/{projectId}/state-templates` (PR-17): the workspace templates a project
 * can adopt, each flagged with `inUse` and `hasOutboundTransition`. */
export default async function getProjectStateTemplates(projectId: string) {
  const response = await client.projects[":projectId"]["state-templates"].$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch state templates");
  }
  return response.json();
}
