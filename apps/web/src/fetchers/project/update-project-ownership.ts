import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** `PATCH /api/projects/{projectId}/ownership` (PR-1): set or clear the parent project. The
 * server needs `project:manage_members` on both projects and enforces the depth cap. */
export default async function updateProjectOwnership({
  projectId,
  parentId,
}: {
  projectId: string;
  parentId: string | null;
}) {
  const response = await client.projects[":projectId"].ownership.$patch({
    param: { projectId },
    json: { parentId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
