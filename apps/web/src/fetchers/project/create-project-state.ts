import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** `POST /api/projects/{projectId}/states` (PR-17): adopt a workspace template as a concrete
 * project state. Returns the project's active states. */
export default async function createProjectState({
  projectId,
  stateTemplateId,
}: {
  projectId: string;
  stateTemplateId: string;
}) {
  const response = await client.projects[":projectId"].states.$post({
    param: { projectId },
    json: { stateTemplateId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
