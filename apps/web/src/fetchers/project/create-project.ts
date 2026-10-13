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
}: CreateProjectRequest) {
  const response = await client.project.$post({
    json: {
      name,
      slug,
      icon,
      workspaceId,
      // Omitted (not null) for an internal project: the API treats both as internal.
      ...(organisationId ? { organisationId } : {}),
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
