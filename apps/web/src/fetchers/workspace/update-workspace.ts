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
};

export default updateWorkspace;
