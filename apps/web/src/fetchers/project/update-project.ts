import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type UpdateProjectRequest = InferRequestType<
  (typeof client)["project"][":id"]["$put"]
>["json"] &
  InferRequestType<(typeof client)["project"][":id"]["$put"]>["param"];

async function updateProject({
  id,
  name,
  icon,
  slug,
  description,
  kind,
  supportLevel,
  serviceCalendarId,
  defaultCommentVisibility,
}: UpdateProjectRequest) {
  const response = await client.project[":id"].$put({
    param: { id },
    // The field is sent only when the caller sets it: the server asks for the strict
    // project:manage_settings capability whenever it is present, so omitting it keeps a
    // plain rename working for callers who lack that capability.
    json: {
      name,
      icon,
      slug,
      description,
      // Engagement fields (PR-9) follow the same rule: the server reads an omitted
      // field as "unchanged" and an explicit null as "clear".
      ...(kind !== undefined ? { kind } : {}),
      ...(supportLevel !== undefined ? { supportLevel } : {}),
      ...(serviceCalendarId !== undefined ? { serviceCalendarId } : {}),
      ...(defaultCommentVisibility !== undefined
        ? { defaultCommentVisibility }
        : {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new HttpError(response.status, error);
  }

  const data = await response.json();

  return data;
}

export default updateProject;
