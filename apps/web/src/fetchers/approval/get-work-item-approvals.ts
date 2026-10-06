import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

async function getWorkItemApprovals(key: string) {
  const response = await client["work-items"][":key"].approvals.$get({
    param: { key },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to fetch work-item approvals");
  return response.json();
}

export default getWorkItemApprovals;
