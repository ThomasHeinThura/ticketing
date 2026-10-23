import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** `PATCH /api/projects/{projectId}/states/{stateId}` (PR-17): move a state and/or make it the
 * project's default. Returns the project's active states. */
export default async function updateProjectState({
  projectId,
  stateId,
  position,
  isDefault,
}: {
  projectId: string;
  stateId: string;
  position?: number;
  isDefault?: true;
}) {
  const response = await client.projects[":projectId"].states[
    ":stateId"
  ].$patch({
    param: { projectId, stateId },
    json: {
      ...(position !== undefined ? { position } : {}),
      ...(isDefault ? { isDefault } : {}),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
