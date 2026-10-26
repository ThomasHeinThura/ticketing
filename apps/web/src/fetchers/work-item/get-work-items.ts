import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import type { WorkItemSortDirection } from "@/lib/routes";
import type {
  WorkItemCustomFieldColumn,
  WorkItemCustomFieldPerson,
} from "@/types/work-item";
import { parseWorkItemRow, type WorkItemRow } from "@/types/work-item";

/** A cycle or module whose members a list read is narrowed to (P5 agile). */
export type WorkItemAgileScope = { cycleId?: string; moduleId?: string };

export type WorkItemsResult = {
  items: WorkItemRow[];
  /**
   * True when at least one row had a field that failed validation at this boundary
   * (`types/work-item/index.ts`'s `parseWorkItemRow`) -- the "partial" state for this
   * screen (G6 / design-principles.md principle 7). This is distinct from `isError`:
   * the request itself succeeded, some or all rows are usable, and the screen renders
   * what it has rather than falling back to the error state.
   */
  hasPartialFailure: boolean;
  /** The server reports another cursor page; consumers must offer bounded paging. */
  hasMore: boolean;
  /** `page.nextCursor`: list and board consumers follow it to load further pages of one project. */
  nextCursor?: string | null;
  /** Search-only metadata for currently selected custom-field columns. */
  customFieldColumns?: WorkItemCustomFieldColumn[];
  /** Search-only, project-bound names referenced by visible custom-field values. */
  customFieldPeople?: WorkItemCustomFieldPerson[];
};

/** Read one validated canonical project page in server order. Cursor traversal is
 * live, not a snapshot: concurrent edits may shift rows between pages. */
async function getWorkItems(
  projectId: string,
  sort: "key" | "position" | "title" | "priority" | "dueDate",
  dir: WorkItemSortDirection,
  options: {
    cursor?: string;
    limit?: number;
    /** P5 agile: narrow to one cycle or module (`cycle` / `module` list filters). */
    scope?: WorkItemAgileScope;
  } = {},
): Promise<WorkItemsResult> {
  const query: Record<string, string> = {
    sort,
    dir,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.limit ? { limit: String(options.limit) } : {}),
    ...(options.scope?.cycleId ? { cycle: options.scope.cycleId } : {}),
    ...(options.scope?.moduleId ? { module: options.scope.moduleId } : {}),
  };
  const response = await client.projects[":projectId"]["work-items"].$get({
    param: { projectId },
    query: query as { sort: typeof sort; dir: typeof dir },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work items");
  }

  const { data, page } = await response.json();
  const items = data.map(parseWorkItemRow);
  const hasPartialFailure = items.some(
    (item) => item.unavailableFields.length > 0,
  );

  return {
    items,
    hasPartialFailure,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

export default getWorkItems;
