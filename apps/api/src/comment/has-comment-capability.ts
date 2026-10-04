import type { Capability } from "@taskdesk/permissions";
import db from "../database";
import { builtInRoleHasCapability } from "../utils/require-workspace-capability";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../utils/workspace-member-roles";

/** Match the same fail-closed role check used by comment creation. */
export default async function hasCommentCapability(
  workspaceId: string | undefined,
  userId: string | undefined,
  capability: Extract<Capability, "comment:create" | "comment:create_internal">,
) {
  if (!workspaceId || !userId) return false;
  const roles = await workspaceMemberRoles(db, workspaceId, userId);
  if (!isUnambiguousMembership(roles)) return false;
  return builtInRoleHasCapability(workspaceId, roles[0], capability);
}
