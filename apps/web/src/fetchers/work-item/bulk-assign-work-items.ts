import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export default async function bulkAssignWorkItems(input: {
  workspaceId: string;
  workItemKeys: string[];
  assigneeId: string;
}) {
  const response = await client["work-items"].bulk.$post({
    json: { ...input, operation: "assign" },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      "Failed to assign selected work items",
    );
  }
  return response.json();
}
