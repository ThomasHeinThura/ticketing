import { HTTPException } from "hono/http-exception";
import { deleteCannedResponseInWorkspace } from "../repository";

export async function deleteCannedResponse(id: string, workspaceId: string) {
  const deleted = await deleteCannedResponseInWorkspace(id, workspaceId);

  if (!deleted) {
    throw new HTTPException(404, { message: "Canned response not found" });
  }

  return deleted;
}

export default deleteCannedResponse;
