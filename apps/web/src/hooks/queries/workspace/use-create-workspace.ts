import { useMutation } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import { authClient } from "@/lib/auth-client";
import {
  createUniqueWorkspaceSlug,
  isWorkspaceSlugCollisionError,
} from "@/lib/utils/create-workspace-slug";

type CreateWorkspaceRequest = {
  name: string;
  description?: string;
  logo?: string;
  slug?: string;
  /**
   * Plugin-era options, kept only so existing call sites still type-check.
   * The native route (S4) always selects the creating session's new
   * workspace/team (effects 7+8 of the create contract) and always derives
   * the owner from the session — there is no "keep current active org" or
   * "create on behalf of another user" native equivalent, and no call site
   * relies on either doing anything: `keepCurrentActiveOrganization` is
   * never passed `true` anywhere in the tree, and the one caller that passes
   * `userId` (onboarding) always passes the current session's own id, which
   * is what the server derives anyway.
   */
  keepCurrentActiveOrganization?: boolean;
  userId?: string;
};

function useCreateWorkspace() {
  return useMutation({
    mutationFn: async ({
      name,
      description,
      logo,
      slug,
    }: CreateWorkspaceRequest) => {
      // S3 scope, left untouched (PR #76 repoints this): the plugin's `list`
      // call is only used here to seed the local slug-collision check below.
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
            logo: logo || undefined,
            // Preserves the plugin-era behaviour of omitting an empty
            // description rather than persisting "" (createWorkspaceCtrl
            // stores `input.description ?? null`).
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
    },
  });
}

export default useCreateWorkspace;
