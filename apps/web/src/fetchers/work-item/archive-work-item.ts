import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

/**
 * `POST /api/v2/work-items/{key}/archive` (`WI-20`, `work_item:update`): hides the item from
 * default views while keeping it and its history. Version-checked like every other field write
 * (`WI-7`); a stale version raises the shared conflict error the menus already handle.
 */
export default async function archiveWorkItem(input: {
  key: string;
  version: number;
}) {
  const response = await client.v2["work-items"][":key"].archive.$post(
    {
      param: { key: input.key },
      header: { "if-match": `"${input.version}"` },
    },
    { headers: { "If-Match": `"${input.version}"` } },
  );
  if (
    response.status === 409 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const conflict = await response.json();
    if (
      typeof conflict === "object" &&
      conflict !== null &&
      typeof conflict.assertedVersion === "number" &&
      typeof conflict.currentVersion === "number"
    )
      throw new WorkItemVersionConflictError(
        conflict.assertedVersion,
        conflict.currentVersion,
      );
  }
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to archive work item"),
    );
  return response.json();
}
