import type { Context } from "hono";
import hasCommentCapability from "../../comment/has-comment-capability";
import { hasWorkspacePermission } from "../../utils/require-workspace-permission";
import { CAPABILITY_CHECKS, type CapabilityName } from "../capability-checks";

export type CapabilityMap = Record<CapabilityName, boolean>;

/**
 * Computes the existing capability checks over `hasWorkspacePermission` and
 * the comment capabilities over the same canonical check used by comment
 * creation. Both use the caller identity and workspace resolved by this route.
 */
async function getCapabilities(c: Context): Promise<CapabilityMap> {
  const entries = Object.entries(CAPABILITY_CHECKS) as Array<
    [CapabilityName, Record<string, string[]>]
  >;
  const results = await Promise.all(
    entries.map(async ([name, permissions]) => {
      if (name === "createPublicComments") {
        return [
          name,
          await hasCommentCapability(
            c.get("workspaceId"),
            c.get("userId"),
            "comment:create",
          ),
        ] as const;
      }
      if (name === "createInternalComments") {
        return [
          name,
          await hasCommentCapability(
            c.get("workspaceId"),
            c.get("userId"),
            "comment:create_internal",
          ),
        ] as const;
      }
      return [name, await hasWorkspacePermission(c, permissions)] as const;
    }),
  );
  return Object.fromEntries(results) as CapabilityMap;
}

export default getCapabilities;
