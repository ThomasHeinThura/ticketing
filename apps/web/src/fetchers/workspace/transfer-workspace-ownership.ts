import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";

type TransferWorkspaceOwnershipBody = InferRequestType<
  (typeof client)["workspace"][":workspaceId"]["transfer-ownership"]["$post"]
>["json"];

type TransferWorkspaceOwnershipRequest = TransferWorkspaceOwnershipBody & {
  workspaceId: string;
};

// S5 (issue #6, retrofit plan §3): THE ATOMIC REPLACEMENT for the client's
// former promote/demote pair (two sequential
// authClient.organization.updateMemberRole() calls, which left a window
// where the workspace briefly had two owners or none). The native route
// (apps/api/src/workspace/controllers/transfer-workspace-ownership.ts) does
// both role changes in one transaction and re-derives the "last owner" rule
// server-side -- this client no longer implements that rule at all.
const transferWorkspaceOwnership = async ({
  workspaceId,
  newOwnerUserId,
}: TransferWorkspaceOwnershipRequest) => {
  const response = await client.workspace[":workspaceId"][
    "transfer-ownership"
  ].$post({
    param: { workspaceId },
    json: { newOwnerUserId },
  });

  if (!response.ok) {
    // `|| "Failed to transfer workspace ownership"` matches the fallback
    // shape the other native workspace writes use (see update-workspace.ts):
    // an empty non-2xx body -- a reverse-proxy 502/504 that never reaches
    // Hono's own error handler, which always supplies a message -- must not
    // become a blank `new Error("")` that renders as a blank toast.
    const error = await response.text();
    throw new Error(error || "Failed to transfer workspace ownership");
  }

  return await response.json();
};

export default transferWorkspaceOwnership;
