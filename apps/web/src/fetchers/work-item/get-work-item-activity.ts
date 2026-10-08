import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export type WorkItemActivityRow = {
  id: string;
  workItemId: string;
  actorId: string | null;
  actorType: string;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  payload: unknown;
  visibility: string;
  workflowVersionId: string | null;
  createdAt: string;
  kind?: "activity" | "comment";
  body?: unknown;
  activityId?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  updatedAt?: string;
};

export type WorkItemActivityPage = {
  data: WorkItemActivityRow[];
  page: { nextCursor: string | null; hasMore: boolean };
};

async function getWorkItemActivity({
  key,
  cursor,
}: {
  key: string;
  cursor?: string;
}): Promise<WorkItemActivityPage> {
  const response = await client["work-items"][":key"].activity.$get({
    param: { key },
    query: { limit: "50", ...(cursor ? { cursor } : {}) },
  });
  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work item activity");
  }
  return response.json();
}

export default getWorkItemActivity;
