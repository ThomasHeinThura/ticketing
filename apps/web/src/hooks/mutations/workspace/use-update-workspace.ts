import { useMutation } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";

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

      // A rename must NOT re-derive the slug: the server contract
      // (apps/api/src/workspace/controllers/update-workspace.ts) is explicit
      // that the slug is part of already-shared URLs and only changes when
      // the caller asks for it. Sending a derived slug here would move it
      // out from under existing links on every plain rename.
      if (name !== undefined) {
        updateData.name = name;
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
        // `|| "Failed to update workspace"` restores the fallback the plugin-era code
        // had (`error.message || ...`). Without it an empty non-2xx body -- a
        // reverse-proxy 502/504 that never reaches Hono's own error handler, which
        // always supplies a message -- becomes `new Error("")`, and general.tsx's
        // `error instanceof Error ? error.message : t(...)` then shows a BLANK toast
        // instead of the translated fallback. The create path kept its fallback; these
        // two lost theirs in the cutover, which made it a regression rather than a gap.
        const error = await response.text();
        throw new Error(error || "Failed to update workspace");
      }

      return await response.json();
    },
  });
}

export default useUpdateWorkspace;
