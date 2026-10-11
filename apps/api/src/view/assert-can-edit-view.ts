import db from "../database";
import type { ApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import {
  assertCallerHasCapabilityOrOwner,
  capabilityCredential,
} from "../utils/require-workspace-capability";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * `PATCH`/`DELETE /api/views/{id}`'s declared policy
 * (search-and-saved-views.md § API): `workspace:manage_settings · orOwner(created_by,
 * saved_view:create)`. Apply the same two conjunctive branches as the route policy,
 * including API-key scope, both at middleware admission and again against the locked row
 * inside the update transaction.
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
  apiKey?: ApiKeyPermissionScope,
  executor: DbOrTx = db,
): Promise<void> {
  await assertCallerHasCapabilityOrOwner(
    view.workspaceId,
    userId,
    "workspace:manage_settings",
    "saved_view:create",
    view.createdBy === personId,
    capabilityCredential(apiKey),
    executor,
  );
}
