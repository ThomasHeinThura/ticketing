import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

export type UpdateWorkItemInput = {
  key: string;
  version: number;
  title: string;
  description: unknown;
  startDate: string | null;
  dueDate: string | null;
};

export default async function updateWorkItem({
  key,
  version,
  ...json
}: UpdateWorkItemInput) {
  const response = await client["work-items"][":key"].$patch(
    {
      param: { key },
      header: { "if-match": `"${version}"` },
      json,
    },
    {
      headers: { "If-Match": `"${version}"` },
    },
  );
  if (response.status === 409) {
    const conflict = (await response.json()) as {
      assertedVersion?: unknown;
      currentVersion?: unknown;
    };
    if (
      typeof conflict.assertedVersion === "number" &&
      typeof conflict.currentVersion === "number"
    ) {
      throw new WorkItemVersionConflictError(
        conflict.assertedVersion,
        conflict.currentVersion,
      );
    }
  }
  if (!response.ok)
    throw new HttpError(response.status, "Failed to update work item");
  return response.json();
}
