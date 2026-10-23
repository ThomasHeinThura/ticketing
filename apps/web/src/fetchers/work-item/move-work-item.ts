import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

/**
 * `POST /api/v2/work-items/{key}/move` (`RH-12`). `moveChildren` is always explicit: the dialog
 * asks the user to choose between moving the sub-items along or leaving them behind detached.
 */
export default async function moveWorkItem(input: {
  key: string;
  version: number;
  targetProjectId: string;
  moveChildren: boolean;
}) {
  const response = await client.v2["work-items"][":key"].move.$post(
    {
      param: { key: input.key },
      header: { "if-match": `"${input.version}"` },
      json: {
        targetProjectId: input.targetProjectId,
        moveChildren: input.moveChildren,
      },
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
      await readErrorDetail(response, "Failed to move work item"),
    );
  return response.json();
}
