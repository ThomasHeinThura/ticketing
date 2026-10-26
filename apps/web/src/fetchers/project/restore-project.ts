import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

async function restoreProject({ id }: { id: string }) {
  const response = await client.project[":id"].restore.$put({
    param: { id },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to restore project");
  }
  return response.json();
}

export default restoreProject;
