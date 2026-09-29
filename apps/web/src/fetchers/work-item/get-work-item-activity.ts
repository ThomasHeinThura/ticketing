import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function getWorkItemActivity(key: string) {
  const response = await client["work-items"][":key"].activity.$get({
    param: { key },
    query: {},
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load work item activity");
  return response.json();
}
