import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export type CreateWorkItemInput = {
  projectId: string;
  typeId: string;
  title: string;
  description?: unknown;
  priority?: "low" | "medium" | "high" | "urgent";
};

/**
 * `POST /api/projects/{projectId}/work-items` (`work_item:create`). The server assigns the
 * key (`WI-2`) and the initial state (`WI-4`); it validates the title (`WI-3`) — the
 * dialog's own validation mirrors that, this is the second line of defence, not the only
 * one.
 */
async function createWorkItem({ projectId, ...body }: CreateWorkItemInput) {
  const response = await client.projects[":projectId"]["work-items"].$post({
    param: { projectId },
    json: body,
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to create work item");
  }

  return response.json();
}

export default createWorkItem;
