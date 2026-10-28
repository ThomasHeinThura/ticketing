import { client } from "@taskdesk/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const item = client["work-items"][":key"];
export type ApprovalRequestContext = InferResponseType<
  (typeof item)["approval-request-context"]["$get"],
  200
>;
export type ApprovalCandidates = InferResponseType<
  (typeof item)["approval-candidates"]["$get"],
  200
>;
export type ApprovalRequestBody = InferRequestType<
  typeof item.approvals.$post
>["json"];
export async function getApprovalRequestContext(key: string) {
  const response = await item["approval-request-context"].$get({
    param: { key },
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Failed to load approval request options",
    );
  return response.json();
}
export async function getApprovalCandidates(
  key: string,
  query: { kind: "customer" | "cab"; q: string; cursor?: string },
) {
  const response = await item["approval-candidates"].$get({
    param: { key },
    query: { ...query, limit: "25" },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load eligible approvers");
  return response.json();
}
export async function requestApproval({
  key,
  body,
}: {
  key: string;
  body: ApprovalRequestBody;
}) {
  const response = await item.approvals.$post({ param: { key }, json: body });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to request approval");
  return response.json();
}
