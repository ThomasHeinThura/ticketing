import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/**
 * `POST /api/work-items/{key}/rank`. `beforeId` is the item that should end up immediately
 * before the moved item's new slot and `afterId` the one immediately after it (both must be
 * in the moved item's own project and state; at least one is required). Rank is exempt from
 * `If-Match` and last-write-wins, so there is no version to send. The status is preserved on
 * the thrown `HttpError` so callers can tell 404 (gone/out of reach) from 400/409/422.
 */
export default async function rankWorkItem(input: {
  key: string;
  beforeId?: string;
  afterId?: string;
}) {
  const response = await client["work-items"][":key"].rank.$post({
    param: { key: input.key },
    json: {
      ...(input.beforeId ? { beforeId: input.beforeId } : {}),
      ...(input.afterId ? { afterId: input.afterId } : {}),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to reorder work item");
  }
  return response.json();
}
