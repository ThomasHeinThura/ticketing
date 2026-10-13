import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

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
      ...(defaultCommentVisibility !== undefined
        ? { defaultCommentVisibility }
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

export default updateProject;
