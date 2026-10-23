import { client } from "@taskdesk/libs";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";

export type DeleteWorkspaceRequest = { id: string };

/** Requests deletion; the workspace is only removed once the requester approves it. */
const deleteWorkspace = async ({ id }: DeleteWorkspaceRequest) => {
  const response = await client.workspace[":workspaceId"].$delete({
    param: { workspaceId: id },
  });
  // The fallback keeps an empty non-2xx body (a proxy 502/504) from becoming a blank toast.
  return readPendingDeletion(response, "Failed to delete workspace");
};

export default deleteWorkspace;
