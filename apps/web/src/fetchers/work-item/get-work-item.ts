import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import {
  parseWorkItemDetailRow,
  type WorkItemDetailRow,
} from "@/types/work-item";

/**
 * `GET /api/work-items/{key}` (`work_item:read`, plus reach on the project).
 *
 * Unlike the list fetcher, this one deliberately does NOT flatten failures: the detail
 * route 404s for a key that doesn't exist (or that the caller can't reach --
 * indistinguishable on purpose, `require-work-item-reach.ts`'s own note), and the screen
 * renders a distinct "not found" state for exactly that case, so the status is preserved
 * on the `HttpError` rather than swallowed here.
 *
 * The response is validated at this boundary by `parseWorkItemDetailRow` (see its own
 * comment) -- `InferResponseType` is a compile-time assertion only.
 */
async function getWorkItem(key: string): Promise<WorkItemDetailRow> {
  const response = await client["work-items"][":key"].$get({
    param: { key },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work item");
  }

  const raw = await response.json();
  return parseWorkItemDetailRow(raw);
}

export default getWorkItem;
