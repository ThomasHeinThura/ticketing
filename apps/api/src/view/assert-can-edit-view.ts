import { HTTPException } from "hono/http-exception";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";

/**
 * `PATCH /api/views/{id}` and `DELETE /api/views/{id}`'s declared policy
 * (search-and-saved-views.md § API): `workspace:manage_settings · orOwner(created_by,
 * saved_view:create)`. A conjunction the same shape `packages/permissions`'s `orOwner`
 * documents -- the owner branch still requires `saved_view:create` -- but every built-in
 * role holding `saved_view:create` is checked at route-declaration time (`viewer` does not
 * hold it), so a caller who owns the row already holds the capability by construction; no
 * extra capability call is needed for that branch here.
 *
 * SV-17's "editable by... team leads" is NOT enforced -- see `saved_view` table's own
 * schema.ts comment: `team_member.is_lead` does not exist in this schema yet. Only the
 * owner, or a caller with `workspace:manage_settings`, may edit a view they did not
 * create.
 */
export async function assertCanEditView(
  view: { workspaceId: string; createdBy: string },
  personId: string,
  userId: string,
): Promise<void> {
  if (view.createdBy === personId) {
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
