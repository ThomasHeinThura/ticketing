import { HTTPException } from "hono/http-exception";
import {
  CannotChangeOwnerRoleHereError,
  WorkspaceRoleNotFoundError,
} from "./controllers/workspace-membership-errors";
import {
  InsufficientPermissionToGrantError,
  InvalidCapabilityError,
  InvalidPermissionResourceError,
  RoleChangedError,
  RoleInIdentityUseError,
  RoleInUseError,
  RoleLimitReachedError,
  RoleNameInvalidError,
  RoleNameReservedError,
  RoleNameTakenError,
  RoleNotEditableError,
  RoleRankError,
  RoleReassignError,
  SelfEditConfirmationError,
  SystemRoleNotDeletableError,
} from "./controllers/workspace-role-errors";
import { LastRoleManagerError } from "./role-governance";

function coded(
  status: 400 | 403 | 404 | 409,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): HTTPException {
  return new HTTPException(status, {
    res: Response.json({ error: code, message, ...extra }, { status }),
  });
}

/**
 * One mapping from a role-domain error to the HTTP answer, shared by every role route so the
 * create, update, delete and reassign surfaces cannot drift. Anything unrecognised is rethrown.
 */
export function roleErrorToHttp(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (
    error instanceof RoleNameReservedError ||
    error instanceof RoleNameInvalidError ||
    error instanceof InvalidPermissionResourceError ||
    error instanceof RoleLimitReachedError
  ) {
    throw new HTTPException(400, { message: error.message });
  }
  if (error instanceof InvalidCapabilityError) {
    throw coded(400, "invalid_capability", error.message, {
      capabilities: error.capabilities,
    });
  }
  if (error instanceof InsufficientPermissionToGrantError) {
    throw coded(403, "beyond_own_authority", error.message, {
      capabilities: error.missingPermissions,
    });
  }
  if (error instanceof RoleRankError) {
    throw coded(403, "rank_guard", error.message);
  }
  if (error instanceof RoleNotEditableError) {
    throw coded(403, "role_not_editable", error.message);
  }
  if (error instanceof SystemRoleNotDeletableError) {
    throw coded(400, "role_not_deletable", error.message);
  }
  if (error instanceof WorkspaceRoleNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  if (error instanceof RoleNameTakenError) {
    throw new HTTPException(409, { message: error.message });
  }
  if (error instanceof LastRoleManagerError) {
    throw coded(409, "last_role_manager", error.message);
  }
  if (error instanceof RoleChangedError) {
    throw coded(409, "role_changed", error.message, { current: error.current });
  }
  if (error instanceof SelfEditConfirmationError) {
    throw coded(409, "self_edit_confirmation_required", error.message, {
      removed: error.removed,
    });
  }
  if (error instanceof RoleInIdentityUseError) {
    throw coded(409, "role_in_identity_use", error.message);
  }
  if (error instanceof RoleInUseError) {
    throw coded(409, "role_in_use", error.message, {
      references: error.references,
    });
  }
  if (
    error instanceof RoleReassignError ||
    error instanceof CannotChangeOwnerRoleHereError
  ) {
    throw coded(400, "reassign_refused", error.message);
  }
  throw error;
}
