import db from "../database";
import { builtInRoleHasCapability } from "../utils/require-workspace-capability";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../utils/workspace-member-roles";

export type CommentCreationCapability =
  | "comment:create"
  | "comment:create_internal";

/**
 * Mirrors the body-dependent comment writer check. The self-introspection map
 * reports this result; it does not grant access or bypass route authorization.
 */
export async function hasCommentCapability(
  workspaceId: string | undefined,
  userId: string | undefined,
  capability: CommentCreationCapability,
): Promise<boolean> {
  if (!workspaceId || !userId) return false;
  const roles = await workspaceMemberRoles(db, workspaceId, userId);
  if (!isUnambiguousMembership(roles)) return false;
  return builtInRoleHasCapability(workspaceId, roles[0], capability, db);
}

export default hasCommentCapability;
