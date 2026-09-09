import { client } from "@taskdesk/libs";

export type DeleteWorkspaceRequest = { id: string };

const deleteWorkspace = async ({ id }: DeleteWorkspaceRequest) => {
  // S4b: native replacement for authClient.organization.delete().
  const response = await client.workspace[":workspaceId"].$delete({
    param: { workspaceId: id },
  });

  if (!response.ok) {
    // `|| "Failed to delete workspace"` restores the fallback the plugin-era code
    // had (`error.message || ...`). Without it an empty non-2xx body -- a
    // reverse-proxy 502/504 that never reaches Hono's own error handler, which
    // always supplies a message -- becomes `new Error("")`, and general.tsx's
    // `error instanceof Error ? error.message : t(...)` then shows a BLANK toast
    // instead of the translated fallback. The create path kept its fallback; these
    // two lost theirs in the cutover, which made it a regression rather than a gap.
    const error = await response.text();
    throw new Error(error || "Failed to delete workspace");
  }

  return await response.json();
};

export default deleteWorkspace;
