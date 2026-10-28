import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export async function getPortalApprovals() {
  const response = await client.portal.approvals.$get();
  if (!response.ok)
    throw new HttpError(response.status, "Unable to load approvals");
  return response.json();
}
export async function decidePortalApproval(input: {
  id: string;
  action: "approve" | "reject";
  note: string;
}) {
  const response = await client.portal.approvals[":id"].decide.$post({
    param: { id: input.id },
    json: { action: input.action, note: input.note.trim() || null },
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Unable to record the approval decision",
    );
  return response.json();
}
