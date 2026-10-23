import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

/**
 * A request never removes the item. Only a separately approved pending action may do so; a
 * repeated request reopens the requester's existing pending action.
 */
export default async function requestWorkItemDeletion(key: string) {
  const response = await apiFetch(
    getApiUrl(`/work-items/${encodeURIComponent(key)}`),
    { method: "DELETE" },
  );
  return readPendingDeletion(response, "Unable to request work item deletion");
}
