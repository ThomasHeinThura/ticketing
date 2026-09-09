import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

type UpdateWorkspaceBody = InferRequestType<
  (typeof client)["workspace"][":workspaceId"]["$patch"]
>["json"];

type UpdateWorkspaceRequest = UpdateWorkspaceBody & { id: string };

const updateWorkspace = async ({
  id,
  name,
  description,
  logo,
  slug,
}: UpdateWorkspaceRequest) => {
  // S4b: native replacement for authClient.organization.update(). The
  // plugin's `metadata` wrapper is gone — `description` is its own column.
  const response = await client.workspace[":workspaceId"].$patch({
    param: { workspaceId: id },
    json: { name, slug, logo, description },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return await response.json();
};

export default updateWorkspace;
