import { client } from "@taskdesk/libs";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError } from "@/lib/http-error";

type BulkWorkItemsResult = {
  succeeded: string[];
  failed: { id: string; reason: string }[];
};

function parseBulkResult(value: unknown): BulkWorkItemsResult {
  if (
    !value ||
    typeof value !== "object" ||
    !("succeeded" in value) ||
    !Array.isArray(value.succeeded) ||
    !value.succeeded.every((key) => typeof key === "string") ||
    !("failed" in value) ||
    !Array.isArray(value.failed) ||
    !value.failed.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.reason === "string",
    )
  )
    throw new Error("Invalid bulk operation result");
  return value as BulkWorkItemsResult;
}

export async function requestBulkWorkItemDeletion(input: {
  workspaceId: string;
  workItemKeys: string[];
}): Promise<
  | { kind: "pending"; pendingActionId: string }
  | { kind: "result"; result: BulkWorkItemsResult }
> {
  const response = await client["work-items"].bulk.$post({
    json: { ...input, operation: "delete" },
  });
  if (response.status === 200)
    return { kind: "result", result: parseBulkResult(await response.json()) };
  // `202` (or a repeated request's `409 pending_approval: <id>`) names the durable action.
  return {
    kind: "pending",
    ...(await readPendingDeletion(response, "Unable to request bulk deletion")),
  };
}

export type BulkWorkItemsOperationInput =
  | {
      workspaceId: string;
      workItemKeys: string[];
      operation: "assign";
      assigneeId: string;
      expectedCurrentAssigneeIds?: Record<string, string | null>;
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
      operation: "add_label" | "remove_label";
      labelId: string;
    }
  | {
      workspaceId: string;
      workItemKeys: string[];
      operation: "set_due_date";
      dueDate: string | null;
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
  if (response.status !== 200) {
    throw new HttpError(
      response.status,
      "Failed to update selected work items",
    );
  }
  return parseBulkResult(await response.json());
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
  expectedCurrentAssigneeIds?: Record<string, string | null>;
}) {
  const response = await client["work-items"].bulk.$post({
    json: { ...input, operation: "assign" },
  });
  if (response.status !== 200) {
    throw new HttpError(
      response.status,
      "Failed to assign selected work items",
    );
  }
  return parseBulkResult(await response.json());
}
