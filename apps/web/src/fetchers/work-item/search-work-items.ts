import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import type {
  WorkItemSearchColumn,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";
import { parseWorkItemFilterText } from "@/lib/work-item-filter";
import { parseWorkItemRow, type WorkItemRow } from "@/types/work-item";

export type StructuredWorkItemsResult = {
  items: WorkItemRow[];
  hasPartialFailure: boolean;
  hasMore: boolean;
};

export default async function searchWorkItems(input: {
  workspaceId: string;
  projectSlug: string;
  filter: string;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  columns?: WorkItemSearchColumn[];
  querySort?: { field: WorkItemSortField; order: WorkItemSortDirection }[];
}): Promise<StructuredWorkItemsResult> {
  const filter = parseWorkItemFilterText(input.filter);
  const projectFilter = {
    field: "project",
    op: "eq",
    value: input.projectSlug,
  } as const;
  const scopedFilter = filter
    ? { op: "and" as const, clauses: [projectFilter, filter] }
    : projectFilter;
  const response = await client["work-items"].search.$post({
    json: {
      workspaceId: input.workspaceId,
      query: {
        entity: "work_item",
        filter: scopedFilter,
        ...(input.querySort ? { sort: input.querySort } : {}),
        ...(input.columns ? { columns: input.columns } : {}),
      },
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: unknown }
      | undefined;
    const message =
      typeof body?.message === "string" && body.message.length <= 512
        ? body.message
        : "Failed to search work items";
    throw new HttpError(response.status, message);
  }
  const { data, page } = await response.json();
  const items = data.map(parseWorkItemRow);
  return {
    items,
    hasPartialFailure: items.some((item) => item.unavailableFields.length > 0),
    hasMore: page.hasMore,
  };
}
