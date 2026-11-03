import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** A-03: the active customers of the project's organisation (needs `work_item:update`). */
export default async function getRequesterCandidates(projectId: string) {
  const response = await client.projects[":projectId"][
    "requester-candidates"
  ].$get({ param: { projectId } });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load requesters");
  return response.json();
}
