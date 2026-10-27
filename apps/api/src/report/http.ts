import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { canSeeRates, holds, identityOf } from "../time-tracking/http";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import type { ReportActor } from "./audit";
import { getDashboardScope } from "./dashboard.repository";
import { getExport } from "./export.service";
import { REPORTS_FEATURE_KEY, workspaceFeatureEnabled } from "./feature";
import { projectOverridesAllowRates } from "./rates";
import type { ReportCaps } from "./run";

export { holds, identityOf };

/**
 * RP-18: the FIRST middleware on every report and dashboard route. A customer, a workspace
 * service key or any other principal that is not a staff person is refused with 403 before the
 * workspace is looked up, before the feature flag (a customer must not learn it from a 409) and
 * before validation (nor from a 400). Reports are the one surface v1 left open to customers.
 */
export async function staffOnly(c: Context, next: Next) {
  await identityOf(c);
  await next();
}

/** `feature.reports` must be on for the request's workspace (409 otherwise). */
export async function requireReports(c: Context, next: Next) {
  if (
    !(await workspaceFeatureEnabled(
      c.get("workspaceId") as string,
      REPORTS_FEATURE_KEY,
    ))
  )
    throw new HTTPException(409, { message: "feature_disabled" });
  await next();
}

export function actorOf(c: Context): ReportActor {
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    userId: c.get("userId") as string,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

/**
 * What the caller may see in this workspace: all projects, rates, other people's time. Rates are
 * resolved at the report's project filter when it has one, and otherwise also need every project
 * role override in the workspace to keep `time_entry:manage_rates` (P5-R2-03, `rates.ts`).
 */
export async function callerCaps(
  c: Context,
  projectId?: string,
): Promise<ReportCaps> {
  const [readAll, showRates, readAnyTime] = await Promise.all([
    holds(c, "report:read_all"),
    (async () =>
      (await canSeeRates(c, projectId)) &&
      (await projectOverridesAllowRates(
        await identityOf(c),
        c.get("workspaceId") as string,
        projectId,
      )))(),
    holds(c, "time_entry:read_any"),
  ]);
  return { readAll, showRates, readAnyTime };
}

/**
 * Dashboard routes by id: resolve the workspace from the row and require access to it. A
 * dashboard of a workspace the caller is not in is a 404, never a 403 that confirms it exists.
 */
export async function dashboardReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing dashboard id" });
  rejectNulByte(id, "Dashboard id");
  const row = await getDashboardScope(id);
  if (!row) throw new HTTPException(404, { message: "Dashboard not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId") as string,
      row.workspaceId,
      (c.get("apiKey") as { id: string } | undefined)?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Dashboard not found" });
    throw error;
  }
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

/**
 * RP-10: `/report-exports/{id}` routes. An export is its requester's: another person's export, and
 * one in a workspace the caller is not in, are both a 404, never a 403 that confirms it exists.
 */
export async function exportReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing export id" });
  rejectNulByte(id, "Export id");
  const row = await getExport(id);
  if (!row) throw new HTTPException(404, { message: "Export not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId") as string,
      row.workspaceId,
      (c.get("apiKey") as { id: string } | undefined)?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Export not found" });
    throw error;
  }
  const identity = await identityOf(c);
  if (row.personId !== identity.personId)
    throw new HTTPException(404, { message: "Export not found" });
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}
