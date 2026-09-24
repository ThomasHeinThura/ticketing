import type { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";

/**
 * The wire shape of `GET /api/workspace/{workspaceId}/work-item-types` — the workspace's
 * configured type catalogue (`WI-1`: every work item has exactly one type, chosen at
 * creation; there is no default type to fall back to).
 */
export type WorkItemType = InferResponseType<
  (typeof client)["workspace"][":workspaceId"]["work-item-types"]["$get"],
  200
>[number];
