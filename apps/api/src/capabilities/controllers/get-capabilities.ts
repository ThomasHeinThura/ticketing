import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import hasCommentCapability from "../../comment/has-comment-capability";
import { assertCallerHasCapability } from "../../utils/require-workspace-capability";
import { hasWorkspacePermission } from "../../utils/require-workspace-permission";
import { CAPABILITY_CHECKS, type CapabilityName } from "../capability-checks";

export type CapabilityMap = Record<CapabilityName, boolean>;

/**
 * Computes the transitional legacy permission checks over `hasWorkspacePermission`,
 * canonical comment checks, and the project-settings capability. All use the caller
 * identity and workspace resolved by this route.
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
  const result = Object.fromEntries(results);
  try {
    await assertCallerHasCapability(
      c.get("workspaceId"),
      c.get("userId"),
      "project:manage_settings",
    );
    result.manageProjectSettings = true;
  } catch (error) {
    if (!(error instanceof HTTPException) || error.status !== 403) throw error;
    result.manageProjectSettings = false;
  }
  return result as CapabilityMap;
}

export default getCapabilities;
