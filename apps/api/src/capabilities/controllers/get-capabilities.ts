import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import hasCommentCapability from "../../comment/has-comment-capability";
import { assertCallerHasCapability } from "../../utils/require-workspace-capability";
import { hasWorkspacePermission } from "../../utils/require-workspace-permission";
import { CAPABILITY_CHECKS, type CapabilityName } from "../capability-checks";

export type CapabilityMap = Record<CapabilityName, boolean> & {
  manageServiceCalendars: boolean;
  manageRequestTypes: boolean;
  triageIntake: boolean;
};

async function getCapabilities(c: Context): Promise<CapabilityMap> {
  const entries = Object.entries(CAPABILITY_CHECKS) as Array<
    [CapabilityName, Record<string, string[]>]
  >;
  const [results, manageServiceCalendars, manageRequestTypes, triageIntake] =
    await Promise.all([
      Promise.all(
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
      ),
      hasServiceCalendarManageCapability(c),
      hasFeatureCapability(c, "request_type:manage"),
      hasFeatureCapability(c, "intake:triage"),
    ]);
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
  return {
    ...result,
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
    // Do not infer this exact write capability from legacy workspace permissions.
    await assertCallerHasCapability(workspaceId, userId, "sla_policy:manage");
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

export default getCapabilities;
