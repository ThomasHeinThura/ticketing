import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";
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
  // Issue #100 (S3 gap): native replacement for authClient.organization.list(),
  // used only to seed the local slug-collision check below. getWorkspaces()
  // (GET /api/workspace, S3's own native read) returns the same caller's-own-
  // workspaces set the plugin call did.
  const existingWorkspaces = slug ? [] : await getWorkspaces();
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
