import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";
import { parseWorkItemRow, type WorkItemRow } from "@/types/work-item";

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
  /**
   * `page.hasMore` from the server (`api-design.md`'s cursor-pagination envelope) --
   * true when this project has more work items than the one page this fetcher
   * requests. #310 added real pagination to the route; this screen does not yet have
   * "load more"/paging UI (out of scope for this change, flagged in the pull request
   * body), so it always requests only the first page at the server's default page size
   * and never follows `page.nextCursor`. Surfacing `hasMore` here, even unused by the
   * component today, keeps that limitation honest and visible rather than silently
   * dropped -- a future paging slice reads it instead of re-deriving it.
   */
  hasMore: boolean;
};

/**
 * `GET /api/projects/{projectId}/work-items` (`work_item:read`, plus reach on the
 * project). `docs/03-features/work-items.md`'s own API table also lists
 * `GET /api/work-items` and `POST /api/work-items/search` -- neither exists yet in
 * `apps/api/src/work-item/index.ts` (only `create`, this list route, `get`, `update`
 * are implemented, per that file's own "#23's first slice" comment). This is a
 * deliberate API gap, not a mistake here: reported in this pull request's body rather
 * than worked around.
 *
 * #310 added server-side sort/pagination/filters: the response is now
 * `{ data, page, meta }` (`docs/01-architecture/api-design.md`'s cursor-pagination
 * envelope), and `sort`/`dir` are real query parameters the server applies -- this
 * fetcher forwards the caller's `sort`/`dir` (`lib/routes.ts`'s URL state) instead of
 * sorting the page client-side (the old client-side sort helper is deleted; nothing
 * else in this codebase called it once this fetcher stopped needing it). Only the
 * first page is requested -- no `cursor` is sent, and none of the server's later pages
 * are fetched -- since this screen has no "load more"/paging UI yet; see
 * `WorkItemsResult`.`hasMore`'s own comment.
 *
 * Each row is validated at this boundary (`parseWorkItemRow`) since `InferResponseType`
 * is a compile-time assertion only, not a runtime check -- see that function's own
 * comment for why this, not a mocked partial-batch shape, is this screen's real
 * "partial" case.
 */
async function getWorkItems(
  projectId: string,
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
): Promise<WorkItemsResult> {
  const response = await client.projects[":projectId"]["work-items"].$get({
    param: { projectId },
    query: { sort, dir },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work items");
  }

  const { data, page } = await response.json();
  const items = data.map(parseWorkItemRow);
  const hasPartialFailure = items.some(
    (item) => item.unavailableFields.length > 0,
  );

  return { items, hasPartialFailure, hasMore: page.hasMore };
}

export default getWorkItems;
