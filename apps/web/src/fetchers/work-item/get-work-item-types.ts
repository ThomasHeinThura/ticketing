import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import type { WorkItemType } from "@/types/work-item-type";

/**
 * `GET /api/workspace/{workspaceId}/work-item-types` (`workspace:read`) — the create
 * dialog's Type picker.
 *
 * Each row's displayed fields are shape-checked here, and a row that fails is dropped:
 * a picker cannot offer a choice it cannot name or address, and the catalogue is
 * workspace configuration the app itself seeds (`default-work-item-types.ts`) — a
 * malformed row is a server bug, not user input. Dropping removes an unusable option
 * instead of letting it be selected and 400 the create request later. If every row
 * fails, the picker's own empty state says there is nothing to choose from.
 */
async function getWorkItemTypes(workspaceId: string): Promise<WorkItemType[]> {
  const response = await client.workspace[":workspaceId"][
    "work-item-types"
  ].$get({
    param: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work item types");
  }

  const raw = await response.json();
  return raw.filter(
    (row) =>
      typeof row.id === "string" &&
      row.id.length > 0 &&
      typeof row.key === "string" &&
      row.key.length > 0 &&
      typeof row.name === "string" &&
      row.name.trim().length > 0,
  );
}

export default getWorkItemTypes;
