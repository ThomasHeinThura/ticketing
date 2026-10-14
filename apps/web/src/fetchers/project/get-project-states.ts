import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** `GET /api/projects/{projectId}/states`: the active states in project order, including
 * states with no work items, which are the board's columns (`VW-8`). */
export default async function getProjectStates(projectId: string) {
  const response = await client.projects[":projectId"].states.$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch project states");
  }
  return response.json();
}
