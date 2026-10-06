import { client } from "@taskdesk/libs";

async function getMyApprovals() {
  const response = await client.me.approvals.$get();
  if (!response.ok) throw new Error("Failed to fetch approvals");
  return response.json();
}

export default getMyApprovals;
