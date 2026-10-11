import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import type { ApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import { assertCanEditView } from "./assert-can-edit-view";
import { teamMemberInWorkspace } from "./repository";
import { resolveCallerPersonId } from "./resolve-person-id";

/**
 * Admission gate for the saved-view PATCH/DELETE `orOwner` policy. The preceding
 * `workspaceAccess.fromSavedView()` middleware supplies both the row's workspace and
 * persisted creator after its existence-and-reach lookup; do not derive either from the
 * request. The handler rechecks PATCH against its locked row.
 */
export function requireSavedViewEditAccess() {
  return async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const workspaceId = c.get("workspaceId") as string | undefined;
    const userId = c.get("userId") as string | undefined;
    const row = c.get("policyRowFacts") as
      | {
          createdBy?: string;
          visibility?: string;
          sharedWithTeamId?: string | null;
        }
      | undefined;
    if (!workspaceId || !userId || !row?.createdBy) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(404, { message: "Saved view not found" });
    }

    try {
      const personId = await resolveCallerPersonId(userId);
      await assertCanEditView(
        { workspaceId, createdBy: row.createdBy },
        personId,
        userId,
        c.get("apiKey") as ApiKeyPermissionScope | undefined,
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        if (
          row.visibility === "team" &&
          row.sharedWithTeamId &&
          row.createdBy !== (await resolveCallerPersonId(userId)) &&
          !(await teamMemberInWorkspace(
            row.sharedWithTeamId,
            userId,
            workspaceId,
          ))
        ) {
          setShadowLegacyAuthorization(c, "denied");
          throw new HTTPException(404, { message: "Saved view not found" });
        }
        setShadowLegacyAuthorization(c, "denied");
      }
      throw error;
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
}
