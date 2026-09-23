import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

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
 */
async function getWorkItems(projectId: string) {
  const response = await client.projects[":projectId"]["work-items"].$get({
    param: { projectId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to fetch work items");
  }

  return response.json();
}

export default getWorkItems;
