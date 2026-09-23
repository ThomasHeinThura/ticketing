import type { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";

/**
 * The wire shape of `GET /api/projects/{projectId}/work-items`
 * (`apps/api/src/work-item/response.ts`'s `workItemSchema`). Note what it does NOT carry,
 * relevant to this screen: `stateId` and `assigneeId` are raw foreign keys, not resolved
 * names -- there is no join/lookup here for a human-readable state label or assignee
 * display name. Flagged as an API gap in this pull request rather than guessed at.
 */
export type WorkItem = InferResponseType<
  (typeof client)["projects"][":projectId"]["work-items"]["$get"],
  200
>[number];

export type WorkItemPriority = "low" | "medium" | "high" | "urgent";
