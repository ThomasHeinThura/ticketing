import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function getWorkItemSla(key: string) {
  const response = await client["work-items"][":key"].sla.$get({
    param: { key },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to load SLA evaluation");
  }
  return response.json();
}
