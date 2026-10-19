import { HTTPException } from "hono/http-exception";
import {
  findUserRole,
  listEnabledApiKeysOfUser,
  listWorkspaceMembershipRows,
} from "./access-lookups.repository";

export async function validateWorkspaceAccess(
  userId: string,
  workspaceId: string,
  apiKeyId?: string,
): Promise<void> {
  if (apiKeyId) {
    const apiKey = await listEnabledApiKeysOfUser(apiKeyId, userId);

    if (apiKey.length === 0) {
      throw new HTTPException(403, {
        message: "Invalid API key for this workspace",
      });
    }
  }

  const user = await findUserRole(userId);

  if (user?.role === "admin") {
    return;
  }

  const membership = await listWorkspaceMembershipRows(userId, workspaceId);

  if (membership.length === 0) {
    throw new HTTPException(403, {
      message: "You don't have access to this workspace",
    });
  }
}
