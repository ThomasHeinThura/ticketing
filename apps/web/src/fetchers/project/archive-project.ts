import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** `PUT /api/project/{id}/archive`: hides the project from the default list (reversible). */
async function archiveProject({ id }: { id: string }) {
  const response = await client.project[":id"].archive.$put({
    param: { id },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to archive project");
  }
  return response.json();
}

export default archiveProject;
