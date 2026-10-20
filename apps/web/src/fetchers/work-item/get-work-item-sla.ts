import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const workItemSla = client["work-items"][":key"].sla;

export type WorkItemSla = InferResponseType<typeof workItemSla.$get, 200>;
export type WorkItemSlaMetric = WorkItemSla["metrics"][number];

/** `GET /api/work-items/{key}/sla` (`work_item:read` plus reach): both SLA clocks. */
export default async function getWorkItemSla(
  key: string,
): Promise<WorkItemSla> {
  const response = await workItemSla.$get({ param: { key } });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to load the work item SLA");
  }
  return response.json();
}
