import {
  type Capability,
  can,
  type ResolvedIdentity,
} from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { auditOriginForApiKey } from "../audit/mcp-origin";
import db from "../database";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { projectAncestryFor } from "../utils/project-ancestry";
import { rejectNulByte } from "../utils/reject-nul-byte";
import {
  assertCallerHasCapability,
  assertCallerHasCapabilityOrOwner,
  capabilityCredential,
} from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import type { TimeActor } from "./audit";
import { getCostEntry, getCostEntryScope } from "./cost-repository";
import {
  COST_TRACKING_FEATURE_KEY,
  TIME_TRACKING_FEATURE_KEY,
  trackingFeatureEnabled,
} from "./feature";
import { getEntry, getEntryScope } from "./repository";

export async function identityOf(c: Context): Promise<ResolvedIdentity> {
  const apiKey = c.get("apiKey");
  // A workspace service key has no person behind it, and every time entry belongs to a person.
  if (apiKey?.service) throw new HTTPException(403, { message: "Forbidden" });
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const identity = await resolveRequestIdentity({
    userId: c.get("userId") as string,
    apiKey,
    impersonatedBy: session?.impersonatedBy,
  });
  if (identity?.side !== "staff")
    throw new HTTPException(403, { message: "Forbidden" });
  return identity;
}

export function actorOf(c: Context): TimeActor {
  const apiKey = c.get("apiKey") as { id: string; isMcp?: boolean } | undefined;
  return {
    userId: c.get("userId") as string,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
    auditOrigin: auditOriginForApiKey(apiKey),
  };
}

/** Does the caller hold `capability` in the request's resolved workspace? */
export async function holds(c: Context, capability: Capability) {
  try {
    await assertCallerHasCapability(
      c.get("workspaceId") as string,
      c.get("userId") as string,
      capability,
      capabilityCredential(c.get("apiKey")),
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

/** `feature.time_tracking` must be on for the request's workspace (409 otherwise). */
export async function requireTimeTracking(c: Context, next: Next) {
  if (
    !(await trackingFeatureEnabled(
      TIME_TRACKING_FEATURE_KEY,
      c.get("workspaceId") as string,
    ))
  )
    throw new HTTPException(409, { message: "feature_disabled" });
  await next();
}

/** `feature.cost_tracking` must be on as well as `feature.time_tracking` (rates, budgets). */
export async function requireCostTracking(c: Context, next: Next) {
  const workspaceId = c.get("workspaceId") as string;
  if (
    !(await trackingFeatureEnabled(TIME_TRACKING_FEATURE_KEY, workspaceId)) ||
    !(await trackingFeatureEnabled(COST_TRACKING_FEATURE_KEY, workspaceId))
  )
    throw new HTTPException(409, { message: "feature_disabled" });
  await next();
}

/**
 * Rates and costs are shown only to `time_entry:manage_rates` holders, and only with cost tracking
 * on (TC-11). With a project in context the capability is resolved AT the project, so a project
 * role override that removes (or grants) it counts exactly as it does for writing.
 */
export async function canSeeRates(c: Context, projectId?: string) {
  const workspaceId = c.get("workspaceId") as string;
  if (!(await trackingFeatureEnabled(COST_TRACKING_FEATURE_KEY, workspaceId)))
    return false;
  if (projectId === undefined) return holds(c, "time_entry:manage_rates");
  return holdsAtProject(
    await identityOf(c),
    "time_entry:manage_rates",
    workspaceId,
    projectId,
  );
}

/** Per-project rate visibility for a result that spans several projects (evaluated once each). */
export async function rateVisibility(
  c: Context,
  rows: ReadonlyArray<{ projectId: string }>,
): Promise<(row: { projectId: string }) => boolean> {
  const seen = new Map<string, boolean>();
  for (const { projectId } of rows)
    if (!seen.has(projectId))
      seen.set(projectId, await canSeeRates(c, projectId));
  return (row) => seen.get(row.projectId) ?? false;
}

/**
 * `PATCH`/`DELETE /api/time-entries/{id}`: resolve the workspace from the entry row, require
 * workspace access (a foreign row is a 404, never a 403 that confirms it exists), and expose the
 * row's person as policy row facts for the `orOwner` branch.
 */
export async function entryReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing entry id" });
  rejectNulByte(id, "Time entry id");
  const row = await getEntryScope(id);
  if (!row) throw new HTTPException(404, { message: "Time entry not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId") as string,
      row.workspaceId,
      (c.get("apiKey") as { id: string } | undefined)?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Time entry not found" });
    throw error;
  }
  // Project reach comes before capability: an entry on a project the caller cannot reach is a 404.
  if (!(await getEntry(await identityOf(c), id)))
    throw new HTTPException(404, { message: "Time entry not found" });
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  c.set("policyRowFacts", { personId: row.personId });
  c.set("timeEntryOwnerId", row.personId);
  await next();
}

/** The contract's own/any split: the owner needs `_own`, anyone else `_any`. */
export function requireEntryCapability(
  anyCapability: "time_entry:update_any" | "time_entry:delete_any",
  ownCapability: "time_entry:update_own" | "time_entry:delete_own",
) {
  return async (c: Context, next: Next) => {
    const identity = await identityOf(c);
    await assertCallerHasCapabilityOrOwner(
      c.get("workspaceId") as string,
      c.get("userId") as string,
      anyCapability,
      ownCapability,
      c.get("timeEntryOwnerId") === identity.personId,
      capabilityCredential(c.get("apiKey")),
    );
    await next();
  };
}

/**
 * `PATCH`/`DELETE /api/cost-entries/{id}`: the same row-first resolution as `entryReach`: a
 * foreign or unreachable row is a 404, never a 403 that confirms it exists. The capability
 * (`time_entry:manage_rates`) is checked against the row's workspace afterwards.
 */
export async function costEntryReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing cost entry id" });
  rejectNulByte(id, "Cost entry id");
  const row = await getCostEntryScope(id);
  if (!row) throw new HTTPException(404, { message: "Cost entry not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId") as string,
      row.workspaceId,
      (c.get("apiKey") as { id: string } | undefined)?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Cost entry not found" });
    throw error;
  }
  const identity = await identityOf(c);
  if (!(await getCostEntry(identity, id)))
    throw new HTTPException(404, { message: "Cost entry not found" });
  // Created at project scope, so changed at project scope: a project role override that removes
  // time_entry:manage_rates for this project blocks edits and deletes as it blocks creation.
  if (
    !(await holdsAtProject(
      identity,
      "time_entry:manage_rates",
      row.workspaceId,
      row.projectId,
    ))
  )
    throw new HTTPException(403, { message: "Insufficient permissions" });
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

/**
 * Does the caller hold `capability` AT the project (a project role that overrides the workspace
 * role for this project counts, exactly as the project-scoped create route evaluates it)? Cost
 * entries are created at project scope, so editing and deleting them must be refused to the same
 * caller, and the quick-add must not be offered to them.
 */
export async function holdsAtProject(
  identity: ResolvedIdentity,
  capability: Capability,
  workspaceId: string,
  projectId: string,
) {
  const ancestorProjectIds = await projectAncestryFor(
    db,
    identity,
    workspaceId,
    projectId,
  );
  return can(identity, capability, "project", {
    projectId,
    workspaceId,
    ancestorProjectIds,
  });
}
