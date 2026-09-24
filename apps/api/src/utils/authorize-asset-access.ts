import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveAssetBearerOrCookie } from "./authenticate-api-request";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type AssetAccessTarget = {
  workspaceId: string;
};

/**
 * Authorizes a request for a stored asset.
 *
 * Every caller must present a credential. TaskDesk has no anonymous asset
 * read path: the inherited kaneo branch that returned early for assets of a
 * public project was removed with `project.is_public` in issue #6.
 */
export async function authorizeAssetAccess(
  c: Context,
  asset: AssetAccessTarget,
): Promise<void> {
  const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);
  try {
    await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);
  } catch (error) {
    // A valid caller who cannot reach this workspace must get the same result
    // as a request for an asset that does not exist. Preserve credential errors
    // such as an invalid API key: they are not a tenant-boundary oracle.
    if (
      error instanceof HTTPException &&
      error.status === 403 &&
      error.message === "You don't have access to this workspace"
    ) {
      throw new HTTPException(404, { message: "Asset not found" });
    }
    throw error;
  }
}
