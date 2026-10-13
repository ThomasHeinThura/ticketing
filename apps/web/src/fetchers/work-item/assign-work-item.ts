import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function assignWorkItem(input: {
  key: string;
  assigneeId: string;
  expectedCurrentAssigneeId?: string | null;
}) {
  const response = await client["work-items"][":key"].assign.$post({
    param: { key: input.key },
    json: {
      assigneeId: input.assigneeId,
      expectedCurrentAssigneeId: input.expectedCurrentAssigneeId,
    },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to assign work item");
  return response.json();
}
