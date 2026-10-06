import type { ApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";

/**
 * `saved_view:share` is the RBAC capability for publishing a view to a team. Membership
 * in the target team is a separate requirement checked by the caller. Keep this as a
 * post-validation check: POST/PATCH allow private-view edits with `saved_view:create`,
 * so the static route policy cannot require the stronger sharing capability for every
 * request.
 */
export async function assertCanShareView(
  workspaceId: string,
  userId: string,
  apiKey?: ApiKeyPermissionScope,
): Promise<void> {
  await assertCallerHasCapability(
    workspaceId,
    userId,
    "saved_view:share",
    apiKey,
  );
}
