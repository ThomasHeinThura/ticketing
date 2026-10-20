import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const myApprovals = client.me.approvals;

export type MyApprovals = InferResponseType<typeof myApprovals.$get, 200>;
export type MyApproval = MyApprovals["approvals"][number];

/**
 * `GET /api/me/approvals`: the caller's pending approvals. Reach is not a filter here, so
 * a row can carry `approverReachLost`.
 */
async function getMyApprovals(): Promise<MyApprovals> {
  const response = await myApprovals.$get();
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch approvals");
  }
  return response.json();
}

export default getMyApprovals;
