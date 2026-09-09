import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";
import { authClient } from "@/lib/auth-client";
import {
  createUniqueWorkspaceSlug,
  isWorkspaceSlugCollisionError,
} from "@/lib/utils/create-workspace-slug";

export type CreateWorkspaceRequest = InferRequestType<
  (typeof client)["workspace"]["$post"]
>["json"];

const createWorkspace = async ({
  name,
  description,
  slug,
  logo,
}: CreateWorkspaceRequest) => {
  // S3 scope, left untouched (PR #76 repoints this): the plugin's `list` call
  // is only used here to seed the local slug-collision check below.
  const existingWorkspaces = slug
    ? []
    : ((await authClient.organization.list()).data ?? []);
  let workspaceSlug = slug
    ? slug
    : createUniqueWorkspaceSlug(
        name,
        existingWorkspaces.map((workspace) => workspace.slug),
      );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    // S4b: native replacement for authClient.organization.create().
    const response = await client.workspace.$post({
      json: {
        name,
        slug: workspaceSlug,
        logo,
        // Preserves the plugin-era behaviour of omitting an empty
        // description rather than persisting "" (createWorkspaceCtrl stores
        // `input.description ?? null`).
        description: description || undefined,
      },
    });

    if (response.ok) {
      return await response.json();
    }

    const message = await response.text();
    const createError = new Error(message || "Failed to create workspace");

    if (slug || !isWorkspaceSlugCollisionError(createError)) {
      throw createError;
    }

    workspaceSlug = createUniqueWorkspaceSlug(name, [
      ...existingWorkspaces.map((workspace) => workspace.slug),
      workspaceSlug,
    ]);
  }

  throw new Error("Failed to create workspace");
};

export default createWorkspace;
