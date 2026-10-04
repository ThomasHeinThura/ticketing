import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function getProjectStates(projectId: string) {
  const response = await client.projects[":projectId"].states.$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch project states");
  }
  return response.json();
}
