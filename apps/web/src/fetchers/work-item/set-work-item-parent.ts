import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";

export async function setWorkItemParent(input: {
  key: string;
  version: number;
  parentKey: string | null;
}) {
  const args = {
    param: { key: input.key },
    header: { "if-match": `"${input.version}"` },
  };
  const options = { headers: { "If-Match": `"${input.version}"` } };
  const route = client.v2["work-items"][":key"].parent;
  const response =
    input.parentKey === null
      ? await route.$delete(args, options)
      : await route.$post(
          { ...args, json: { parentKey: input.parentKey } },
          options,
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
    ) {
      throw new WorkItemVersionConflictError(
        conflict.assertedVersion,
        conflict.currentVersion,
      );
    }
    throw new HttpError(409, "Parent change conflicted; reload and retry");
  }
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to change parent"),
    );
  return response.json();
}

export async function getParentCandidate(key: string, signal: AbortSignal) {
  const response = await client["work-items"][":key"].$get(
    { param: { key } },
    { init: { signal } },
  );
  if (!response.ok)
    throw new HttpError(response.status, await readErrorDetail(response));
  return response.json();
}
