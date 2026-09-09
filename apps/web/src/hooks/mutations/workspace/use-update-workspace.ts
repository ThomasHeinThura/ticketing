import { useMutation } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import { createSlug } from "@/lib/utils/create-slug";

type UpdateWorkspaceRequest = {
  workspaceId: string;
  name?: string;
  description?: string;
  slug?: string;
  logo?: string;
  /**
   * Plugin-era option, kept only so existing call sites still type-check.
   * The native `PATCH /api/workspace/{workspaceId}` body has no `metadata`
   * field — `description` is its own column, not a metadata entry — and no
   * call site passes this.
   */
  metadata?: Record<string, unknown>;
};

function useUpdateWorkspace() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      name,
      description,
      slug,
      logo,
    }: UpdateWorkspaceRequest) => {
      const updateData: {
        name?: string;
        description?: string;
        slug?: string;
        logo?: string;
      } = {};

      if (name !== undefined) {
        updateData.name = name;
        if (slug === undefined) {
          updateData.slug = createSlug(name);
        }
      }

      if (slug !== undefined) {
        updateData.slug = slug;
      }

      if (description !== undefined) {
        updateData.description = description;
      }

      if (logo !== undefined) {
        updateData.logo = logo;
      }

      // S4b: native replacement for authClient.organization.update().
      const response = await client.workspace[":workspaceId"].$patch({
        param: { workspaceId },
        json: updateData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return await response.json();
    },
  });
}

export default useUpdateWorkspace;
