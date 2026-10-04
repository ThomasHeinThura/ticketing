import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function getAssignablePeople(projectId: string) {
  const response = await client.projects[":projectId"].assignable.$get({
    param: { projectId },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load assignable people");
  return response.json();
}
