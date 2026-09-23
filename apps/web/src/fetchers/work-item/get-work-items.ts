import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
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
 * No pagination, no sort/filter query parameters -- `list-work-items.ts`'s own comment
 * states the list is not paginated in this first slice and always returns the whole
 * project. This screen does its own client-side sort (`lib/routes.ts`'s `sort`/`dir`
 * URL state) over the full list for the same reason.
 *
 * Each row is validated at this boundary (`parseWorkItemRow`) since `InferResponseType`
 * is a compile-time assertion only, not a runtime check -- see that function's own
 * comment for why this, not a mocked partial-batch shape, is this screen's real
 * "partial" case.
 */
async function getWorkItems(projectId: string): Promise<WorkItemsResult> {
  const response = await client.projects[":projectId"]["work-items"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work items");
  }

  const raw = await response.json();
  const items = raw.map(parseWorkItemRow);
  const hasPartialFailure = items.some(
    (item) => item.unavailableFields.length > 0,
  );

  return { items, hasPartialFailure };
}

export default getWorkItems;
