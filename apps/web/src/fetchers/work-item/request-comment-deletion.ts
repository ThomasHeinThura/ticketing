import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

/**
 * A request never removes the comment. Only a separately approved pending action may do so; a
 * repeated request reopens the requester's existing pending action.
 */
export default async function requestCommentDeletion(id: string) {
  const response = await apiFetch(
    getApiUrl(`/comments/${encodeURIComponent(id)}`),
    { method: "DELETE" },
  );
  return readPendingDeletion(response, "Unable to request comment deletion");
}
