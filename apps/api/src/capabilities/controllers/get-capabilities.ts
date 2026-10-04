import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { assertCallerHasCapability } from "../../utils/require-workspace-capability";
import { hasWorkspacePermission } from "../../utils/require-workspace-permission";
import { CAPABILITY_CHECKS, type CapabilityName } from "../capability-checks";

export type CapabilityMap = Record<CapabilityName, boolean> & {
  manageServiceCalendars: boolean;
  manageRequestTypes: boolean;
  triageIntake: boolean;
};

/**
 * Computes the 16 legacy permission checks in parallel over `hasWorkspacePermission`,
 * which reads `c.get("workspaceId")` / `c.get("userId")` / `c.get("apiKey")`
 * itself -- the same context vars every other authenticated route already
 * relies on. No new authorization primitive is introduced here.
 */
async function getCapabilities(c: Context): Promise<CapabilityMap> {
  const entries = Object.entries(CAPABILITY_CHECKS) as Array<
    [CapabilityName, Record<string, string[]>]
  >;
  const [results, manageServiceCalendars, manageRequestTypes, triageIntake] =
    await Promise.all([
      Promise.all(
        entries.map(
          async ([name, permissions]) =>
            [name, await hasWorkspacePermission(c, permissions)] as const,
        ),
      ),
      hasServiceCalendarManageCapability(c),
      hasFeatureCapability(c, "request_type:manage"),
      hasFeatureCapability(c, "intake:triage"),
    ]);
  return {
    ...Object.fromEntries(results),
    manageServiceCalendars,
    manageRequestTypes,
    triageIntake,
  } as CapabilityMap;
}

async function hasFeatureCapability(
  c: Context,
  capability: "request_type:manage" | "intake:triage",
): Promise<boolean> {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  if (!workspaceId || !userId) return false;
  try {
    await assertCallerHasCapability(workspaceId, userId, capability);
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

async function hasServiceCalendarManageCapability(
  c: Context,
): Promise<boolean> {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  if (!workspaceId || !userId) return false;

  try {
    // This separate exact check mirrors the canonical guard used by the
    // service-calendar write routes. It intentionally does not infer
    // sla_policy:manage from a legacy workspace-management permission.
    await assertCallerHasCapability(workspaceId, userId, "sla_policy:manage");
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

export default getCapabilities;
