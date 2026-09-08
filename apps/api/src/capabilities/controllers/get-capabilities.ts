import type { Context } from "hono";
import { hasWorkspacePermission } from "../../utils/require-workspace-permission";
import { CAPABILITY_CHECKS, type CapabilityName } from "../capability-checks";

export type CapabilityMap = Record<CapabilityName, boolean>;

/**
 * Computes all 16 capability checks in parallel over `hasWorkspacePermission`,
 * which reads `c.get("workspaceId")` / `c.get("userId")` / `c.get("apiKey")`
 * itself -- the same context vars every other authenticated route already
 * relies on. No new authorization primitive is introduced here.
 */
async function getCapabilities(c: Context): Promise<CapabilityMap> {
  const entries = Object.entries(CAPABILITY_CHECKS) as Array<
    [CapabilityName, Record<string, string[]>]
  >;
  const results = await Promise.all(
    entries.map(
      async ([name, permissions]) =>
        [name, await hasWorkspacePermission(c, permissions)] as const,
    ),
  );
  return Object.fromEntries(results) as CapabilityMap;
}

export default getCapabilities;
