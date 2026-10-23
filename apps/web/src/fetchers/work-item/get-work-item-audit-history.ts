import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const entityHistory = client.audit.entity[":type"][":id"];
const reconstruct = client["work-items"][":key"].reconstruct;

export type WorkItemAuditHistory = InferResponseType<
  typeof entityHistory.$get,
  200
>;
export type WorkItemReconstruction = InferResponseType<
  typeof reconstruct.$get,
  200
>;

/** `GET /api/audit/entity/work_item/{key}` (`work_item:read` plus reach): the item's audit rows. */
export async function getWorkItemAuditHistory(
  key: string,
): Promise<WorkItemAuditHistory> {
  const response = await entityHistory.$get({
    param: { type: "work_item", id: key },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load the audit history");
  return response.json();
}

/** `GET /api/work-items/{key}/reconstruct?at=` (AU-8/AU-9): field values as of an instant. */
export async function getWorkItemReconstruction(
  key: string,
  at: string,
): Promise<WorkItemReconstruction> {
  const response = await reconstruct.$get({ param: { key }, query: { at } });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to reconstruct the work item");
  return response.json();
}
