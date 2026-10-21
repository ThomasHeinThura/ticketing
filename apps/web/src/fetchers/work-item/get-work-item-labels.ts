import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export async function getWorkItemLabels(key: string) {
  const response = await client["work-items"][":key"].labels.$get({
    param: { key },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load work-item labels");
  return response.json();
}
