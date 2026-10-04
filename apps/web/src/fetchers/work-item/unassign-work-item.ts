import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function unassignWorkItem(key: string) {
  const response = await client["work-items"][":key"].assign.$delete({
    param: { key },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to unassign work item");
  return response.json();
}
