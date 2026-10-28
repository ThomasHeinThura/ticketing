import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

export default async function restoreWorkItem(input: {
  key: string;
  version: number;
}) {
  const response = await client.v2["work-items"][":key"].restore.$post(
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
      "assertedVersion" in conflict &&
      "currentVersion" in conflict &&
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
      await readErrorDetail(response, "Failed to restore work item"),
    );
  return response.json();
}
