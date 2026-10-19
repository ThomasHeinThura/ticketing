import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export type BulkWorkItemsOperationInput =
  | {
      workspaceId: string;
      workItemKeys: string[];
      operation: "assign";
      assigneeId: string;
    }
  | {
      workspaceId: string;
      workItemKeys: string[];
      operation: "set_priority";
      priority: "low" | "medium" | "high" | "urgent" | null;
    }
  | {
      workspaceId: string;
      workItemKeys: string[];
      operation: "archive";
    }
  | {
      workspaceId: string;
      workItemKeys: string[];
      operation: "delete";
    }
  | {
      workspaceId: string;
      workItemKeys: string[];
      operation: "transition";
      toStateTemplateId: string;
    };

export async function bulkWorkItemsOperation(
  input: BulkWorkItemsOperationInput,
) {
  const response = await client["work-items"].bulk.$post({
    json: input,
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      "Failed to update selected work items",
    );
  }
  return response.json();
}

/**
 * `POST /api/work-items/bulk` with `operation: "assign"`. The server re-checks reach and
 * capability per item (`WI-25`) and answers 200 with `succeeded` and per-item `failed`
 * reasons; a non-2xx here means the whole request was refused.
 */
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
