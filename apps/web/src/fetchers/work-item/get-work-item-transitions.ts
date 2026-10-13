import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function getWorkItemTransitions(key: string) {
  const response = await client["work-items"][":key"].transitions.$get({
    param: { key },
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Failed to load work item transitions",
    );
  return response.json();
}
