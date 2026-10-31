import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

export type CreateProjectRequest = InferRequestType<
  (typeof client)["project"]["$post"]
>["json"];

async function createProject({
  name,
  slug,
  workspaceId,
  icon,
  organisationId,
  kind,
  supportLevel,
  serviceCalendarId,
}: CreateProjectRequest) {
  const response = await client.project.$post({
    json: {
      name,
      slug,
      icon,
      workspaceId,
      // Omitted (not null) for an internal project: the API treats both as internal.
      ...(organisationId ? { organisationId } : {}),
      // A delivery project sends no engagement fields, so it keeps the API defaults
      // (kind `project`, calendar mode `inherit`). A managed service sends its kind and
      // support level; `serviceCalendarId` is sent only for an explicit calendar, because
      // the API reads any sent value (even null) as a calendar override.
      ...(kind === "managed_service"
        ? {
            kind,
            supportLevel: supportLevel ?? null,
            ...(serviceCalendarId ? { serviceCalendarId } : {}),
          }
        : {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();

  return data;
}

export default createProject;
