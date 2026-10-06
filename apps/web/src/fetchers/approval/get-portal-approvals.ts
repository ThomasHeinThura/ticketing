import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

async function getPortalApprovals() {
  const response = await client.portal.approvals.$get();
  if (!response.ok)
    throw new HttpError(response.status, "Failed to fetch portal approvals");
  return response.json();
}

export default getPortalApprovals;
