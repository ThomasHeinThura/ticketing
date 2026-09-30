import { HTTPException } from "hono/http-exception";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";

/**
 * `PATCH /api/views/{id}` and `DELETE /api/views/{id}`'s declared policy
 * (search-and-saved-views.md § API): `workspace:manage_settings · orOwner(created_by,
 * saved_view:create)`. The runtime checks below mirror both branches of the registered route
 * policy.
 *
 * SV-17's team-lead branch is not yet enforceable: `team_member.is_lead` is absent from the
 * current schema (issue #445). Until that data-model work lands, the checked branches are
 * the owner and `workspace:manage_settings`.
 */
export async function assertCanEditView(
  view: { workspaceId: string; createdBy: string },
  personId: string,
  userId: string,
): Promise<void> {
  if (view.createdBy === personId) {
    await assertCallerHasCapability(
      view.workspaceId,
      userId,
      "saved_view:create",
    );
    return;
  }
  try {
    await assertCallerHasCapability(
      view.workspaceId,
      userId,
      "workspace:manage_settings",
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw new HTTPException(403, {
        message:
          "Only the view's owner, or workspace:manage_settings, may edit it",
      });
    }
    throw error;
  }
}
