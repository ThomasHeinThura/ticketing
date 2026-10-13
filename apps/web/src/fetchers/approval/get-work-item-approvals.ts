import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const workItemApprovals = client["work-items"][":key"].approvals;

export type WorkItemApprovals = InferResponseType<
  typeof workItemApprovals.$get,
  200
>;
export type WorkItemApproval = WorkItemApprovals["approvals"][number];

/**
 * `GET /api/work-items/{key}/approvals` (`work_item:read`, plus reach on the work item).
 * The status is preserved on the `HttpError` so the caller can tell an expired session
 * (401, handled app-wide) from a vanished or out-of-reach item (404).
 */
async function getWorkItemApprovals(key: string): Promise<WorkItemApprovals> {
  const response = await workItemApprovals.$get({ param: { key } });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work item approvals");
  }
  return response.json();
}

export default getWorkItemApprovals;
