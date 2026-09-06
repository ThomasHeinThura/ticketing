import type { Context } from "hono";
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
  await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);
}
