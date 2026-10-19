import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { deleteCannedResponseInWorkspace } from "../repository";

export async function deleteCannedResponse(
  identity: ResolvedIdentity,
  id: string,
  workspaceId: string,
) {
  const deleted = await deleteCannedResponseInWorkspace(
    identity,
    id,
    workspaceId,
  );

  if (!deleted) {
    throw new HTTPException(404, { message: "Canned response not found" });
  }

  return deleted;
}

export default deleteCannedResponse;
