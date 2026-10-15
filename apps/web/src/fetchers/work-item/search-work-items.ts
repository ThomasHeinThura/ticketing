import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import {
  isWorkItemSearchSortField,
  type WorkItemSearchColumn,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";
import { parseWorkItemFilterText } from "@/lib/work-item-filter";
import { parseWorkItemRow, type WorkItemRow } from "@/types/work-item";

export type StructuredWorkItemsResult = {
  items: WorkItemRow[];
  hasPartialFailure: boolean;
  hasMore: boolean;
  nextCursor?: string | null;
};

const MAX_ERROR_DETAIL_LENGTH = 512;

/**
 * The API reports a refused filter (`400`, `422` naming the field, `403`) as a short message.
 * Hono's `HTTPException` answers with plain text and other routes with a JSON body, so both
 * are read; anything long or non-printable is dropped for the generic message.
 */
async function readErrorDetail(response: Response): Promise<string> {
  const fallback = "Failed to search work items";
  let text: string;
  try {
    text = await response.text();
  } catch {
    return fallback;
  }
  let detail: unknown = text;
  try {
    const body = JSON.parse(text) as { message?: unknown; detail?: unknown };
    detail = body.message ?? body.detail;
  } catch {
    // Not JSON: the text itself is the message.
  }
  if (typeof detail !== "string") return fallback;
  const trimmed = detail.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_ERROR_DETAIL_LENGTH ||
    [...trimmed].some((character) => character.charCodeAt(0) < 32)
  )
    return fallback;
  return trimmed;
}

/**
 * The sort the search endpoint accepts for the list's current sort. `position` is the list
 * route's rank order and is not a search sort, so it is not forwarded (the endpoint then
 * defaults to `key asc`).
 */
export function toSearchSort(
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
): {
  field: "key" | "title" | "priority" | "dueDate";
  order: "asc" | "desc";
}[] {
  return isWorkItemSearchSortField(sort) ? [{ field: sort, order: dir }] : [];
}

/**
 * `POST /api/work-items/search` (`work_item:read`, workspace from the body). The list's
 * project is added as a leading `project` clause: the endpoint's own scope is the workspace
 * and the actor's reach, never the page the user happens to be on. Absent columns are not
 * synthesised, and an empty sort is omitted rather than defaulted, so the stored query
 * document carries only what the user chose.
 */
export default async function searchWorkItems(input: {
  workspaceId: string;
  projectSlug: string;
  filter: string;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  columns?: WorkItemSearchColumn[];
}): Promise<StructuredWorkItemsResult> {
  let filter: ReturnType<typeof parseWorkItemFilterText>;
  try {
    filter = parseWorkItemFilterText(input.filter);
  } catch (error) {
    // A malformed filter arriving from the URL is a bad request the user can fix in the
    // editor; it is never sent to the endpoint.
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid filter text.",
    );
  }
  const projectFilter = {
    field: "project",
    op: "eq",
    value: input.projectSlug,
  } as const;
  const scopedFilter = filter
    ? { op: "and" as const, clauses: [projectFilter, filter] }
    : projectFilter;
  const sort = toSearchSort(input.sort, input.dir);
  const response = await client["work-items"].search.$post({
    json: {
      workspaceId: input.workspaceId,
      query: {
        entity: "work_item",
        filter: scopedFilter,
        ...(sort.length > 0 ? { sort } : {}),
        ...(input.columns ? { columns: input.columns } : {}),
      },
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await readErrorDetail(response));
  }
  const { data, page } = await response.json();
  const items = data.map(parseWorkItemRow);
  return {
    items,
    hasPartialFailure: items.some((item) => item.unavailableFields.length > 0),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}
