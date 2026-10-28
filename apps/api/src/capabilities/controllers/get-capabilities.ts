import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import hasCommentCapability from "../../comment/has-comment-capability";
import { isCustomerPrincipal } from "../../utils/is-customer-principal";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "../../utils/require-workspace-capability";
import { hasWorkspacePermission } from "../../utils/require-workspace-permission";
import { CAPABILITY_CHECKS, type CapabilityName } from "../capability-checks";

export type CapabilityMap = Record<CapabilityName, boolean> & {
  manageServiceCalendars: boolean;
  shareSavedViews: boolean;
  triageIntake: boolean;
  manageWorkspaceSettings: boolean;
  // Strict canonical checks (rbac.md `work_item:transition`, `work_item:rank`,
  // `project:manage_settings`): never derived from the legacy better-auth statement map,
  // which grants members more than the permission matrix does (#708).
  transitionTasks: boolean;
  rankTasks: boolean;
  exportTasks: boolean;
  setPriorityTasks: boolean;
  manageProjectSettings: boolean;
  // Per-area settings capabilities, exactly what each settings API enforces, so navigation and
  // pages follow the server instead of the broader `workspace:manage_settings`.
  manageRoles: boolean;
  manageWebhooks: boolean;
  manageCustomFields: boolean;
  // P5: time_entry:manage_rates (Rates), workflow:manage (Workflows, CAB template) and
  // budget:read (project Budget), exactly what those APIs enforce.
  manageRates: boolean;
  manageWorkflows: boolean;
  readBudgets: boolean;
  // time_entry:create (log time, run the timer): the Timesheet entry and the work item Time
  // section, exactly what the time APIs enforce (the built-in Viewer role lacks it).
  logTime: boolean;
  bindProjectOrganisation: boolean;
  manageLabels: boolean;
  createAttachments: boolean;
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
  const [
    results,
    manageServiceCalendars,
    shareSavedViews,
    triageIntake,
    manageWorkspaceSettings,
    transitionTasks,
    rankTasks,
    exportTasks,
    setPriorityTasks,
    manageProjectSettings,
    bindProjectOrganisation,
    manageLabels,
    createAttachments,
    manageRoles,
    manageWebhooks,
    manageCustomFields,
    manageRates,
    manageWorkflows,
    readBudgets,
    logTime,
  ] = await Promise.all([
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
    hasCanonicalCapability(c, "saved_view:share"),
    hasCanonicalCapability(c, "intake:triage"),
    hasCanonicalCapability(c, "workspace:manage_settings"),
    hasCanonicalCapability(c, "work_item:transition"),
    hasCanonicalCapability(c, "work_item:rank"),
    hasCanonicalCapability(c, "work_item:export"),
    hasCanonicalCapability(c, "work_item:set_priority"),
    hasCanonicalCapability(c, "project:manage_settings"),
    hasCanonicalCapability(c, "project:create"),
    hasCanonicalCapability(c, "label:manage"),
    hasCanonicalCapability(c, "attachment:create"),
    hasCanonicalCapability(c, "workspace:manage_roles"),
    hasCanonicalCapability(c, "webhook:manage"),
    hasCanonicalCapability(c, "custom_field:manage"),
    hasCanonicalCapability(c, "time_entry:manage_rates"),
    hasCanonicalCapability(c, "workflow:manage"),
    hasCanonicalCapability(c, "budget:read"),
    hasCanonicalCapability(c, "time_entry:create"),
  ]);
  // The agent API refuses customer principals on item-scoped routes (403), so the UI must not
  // be told it may rank or comment publicly there. Same predicate the routes use
  // (`utils/is-customer-principal.ts`); customers act through the portal routes only.
  const customer = await isCustomerPrincipal(
    c.get("userId"),
    c.get("workspaceId"),
  );
  const agentOnly = (value: boolean) => value && !customer;
  const flags = Object.fromEntries(results) as Record<string, boolean>;
  if (flags.createPublicComments !== undefined) {
    flags.createPublicComments = agentOnly(flags.createPublicComments);
  }
  return {
    ...flags,
    manageServiceCalendars,
    shareSavedViews,
    triageIntake: agentOnly(triageIntake),
    manageWorkspaceSettings,
    transitionTasks,
    rankTasks: agentOnly(rankTasks),
    exportTasks: agentOnly(exportTasks),
    setPriorityTasks: agentOnly(setPriorityTasks),
    manageProjectSettings,
    manageRoles,
    manageWebhooks,
    manageCustomFields,
    manageRates,
    manageWorkflows,
    readBudgets,
    logTime,
    bindProjectOrganisation,
    manageLabels,
    createAttachments: agentOnly(createAttachments),
  } as CapabilityMap;
}

async function hasCanonicalCapability(
  c: Context,
  capability:
    | "intake:triage"
    | "saved_view:share"
    | "workspace:manage_settings"
    | "work_item:transition"
    | "work_item:rank"
    | "work_item:export"
    | "work_item:set_priority"
    | "project:manage_settings"
    | "project:create"
    | "label:manage"
    | "attachment:create"
    | "workspace:manage_roles"
    | "webhook:manage"
    | "custom_field:manage"
    | "time_entry:manage_rates"
    | "workflow:manage"
    | "budget:read"
    | "time_entry:create",
): Promise<boolean> {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  if (!workspaceId || !userId) return false;
  try {
    await assertCallerHasCapability(
      workspaceId,
      userId,
      capability,
      capabilityCredential(c.get("apiKey")),
    );
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
    await assertCallerHasCapability(
      workspaceId,
      userId,
      "sla_policy:manage",
      capabilityCredential(c.get("apiKey")),
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

export default getCapabilities;
