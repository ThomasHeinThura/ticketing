import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

export type UpdateWorkItemInput = {
  key: string;
  version: number;
  // PATCH is partial: send only the fields that changed. An omitted field is left alone
  // by the server; an explicit null clears it.
  labelIds?: string[];
  title?: string;
  description?: unknown;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  startDate?: string | null;
  dueDate?: string | null;
  // CF-3: custom field values by key; null clears a field. Validated server-side.
  customFields?: Record<string, unknown>;
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
    throw new HttpError(
      response.status,
      // A 400 names the custom field that was refused; other failures stay generic.
      response.status === 400
        ? await readErrorDetail(response, "Failed to update work item")
        : "Failed to update work item",
    );
  return response.json();
}
