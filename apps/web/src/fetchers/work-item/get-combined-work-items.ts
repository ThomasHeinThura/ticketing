import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import type {
  WorkItemSearchColumn,
  WorkItemSort,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";
import { parseWorkItemRow } from "@/types/work-item";
import type {
  CombinedWorkItemColumn,
  CombinedWorkItemRow,
} from "@/types/work-item/combined";
import { parseFilterTextOrThrow, toSearchSorts } from "./search-work-items";

const COMBINED_BOARD_PAGE_SIZE = 200;

/** Read the visible descendant subtree without putting project IDs in the request body. */
export default async function getCombinedWorkItems(input: {
  projectId: string;
  filter: string;
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  sorts?: WorkItemSort[];
  columns?: WorkItemSearchColumn[];
  cursor?: string;
}) {
  const filter = parseFilterTextOrThrow(input.filter);
  const response = await client.projects[":projectId"][
    "work-items"
  ].combined.$post({
    param: { projectId: input.projectId },
    json: {
      limit: COMBINED_BOARD_PAGE_SIZE,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      query: {
        entity: "work_item",
        ...(filter ? { filter } : {}),
        sort: toSearchSorts(input.sorts, input.sort, input.dir),
        ...(input.columns ? { columns: input.columns } : {}),
      },
    },
  });
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load combined work items"),
    );
  }
  const { data, columns, page, meta, customFieldColumns, customFieldPeople } =
    await response.json();
  const items = data.map((row) => ({
    ...parseWorkItemRow(row),
    stateTemplateId: row.stateTemplateId,
    sourceProject: row.sourceProject,
  })) satisfies CombinedWorkItemRow[];

  return {
    items,
    columns: columns satisfies CombinedWorkItemColumn[],
    hasPartialFailure: items.some((item) => item.unavailableFields.length > 0),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    total: meta.total,
    ...(customFieldColumns ? { customFieldColumns } : {}),
    ...(customFieldPeople ? { customFieldPeople } : {}),
  };
}
