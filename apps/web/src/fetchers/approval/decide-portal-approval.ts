import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

async function decidePortalApproval(input: {
  id: string;
  action: "approve" | "reject";
  note?: string;
}) {
  const response = await client.portal.approvals[":id"].decide.$post({
    param: { id: input.id },
    json: { action: input.action, ...(input.note ? { note: input.note } : {}) },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to record approval decision");
  return response.json();
}

export default decidePortalApproval;
