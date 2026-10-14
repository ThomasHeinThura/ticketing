import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/**
 * `DELETE /api/work-items/{key}/assign?expectedAssigneeId=...` (#723). The expected holder
 * is the one the screen showed; if someone else changed it the server answers 409 and
 * writes nothing, so a stale screen can never clear a newer holder.
 */
export default async function unassignWorkItem(
  key: string,
  expectedAssigneeId: string | null,
) {
  const response = await client["work-items"][":key"].assign.$delete({
    param: { key },
    query: expectedAssigneeId === null ? {} : { expectedAssigneeId },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to unassign work item");
  return response.json();
}
