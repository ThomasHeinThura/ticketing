import {
  type ProjectReachFacts,
  type ResolvedIdentity,
  reaches,
} from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { projectFacts } from "../automation/access";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import {
  hasProjectReadCapability,
  resolveCallerIdentity,
} from "../utils/has-project-reach";
import { markReach } from "../utils/reach-mark";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import type { AgileActor } from "./audit";
import { findCycleScope, findModuleScope } from "./scope.repository";

export { projectFromKeyParam } from "../automation/access";

export type AgileCapability =
  | "project:read"
  | "project:manage_settings"
  | "work_item:read"
  | "work_item:update";

export type ProjectScope = { workspaceId: string; projectId: string };

/** The caller's identity and the facts of the project they reach; 404 when not reachable. */
export async function authoriseProject(
  c: Context,
  scope: ProjectScope,
  capability: AgileCapability,
): Promise<{
  identity: ResolvedIdentity;
  facts: ProjectReachFacts;
  actor: AgileActor;
}> {
  const identity = await resolveCallerIdentity(c, c.get("userId"));
  // A customer is never a reader or author of cycles, modules or estimates.
  if (identity?.side !== "staff")
    throw new HTTPException(403, { message: "Insufficient permissions" });
  const facts = await projectFacts(identity, scope);
  if (!facts || !reaches(identity, facts))
    throw new HTTPException(404, { message: "Project not found" });
  if (!hasProjectReadCapability(identity, capability, "project", facts))
    throw new HTTPException(403, { message: "Insufficient permissions" });
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    identity,
    facts,
    actor: {
      userId: c.get("userId"),
      personId: identity.personId,
      actorType: apiKey ? "api_key" : "person",
      apiKeyId: apiKey?.id ?? null,
    },
  };
}

/** Whether the caller holds the capability at this project (no refusal). */
export function holds(
  identity: ResolvedIdentity,
  facts: ProjectReachFacts,
  capability: AgileCapability,
): boolean {
  return hasProjectReadCapability(identity, capability, "project", facts);
}

function rowReach(kind: "cycle" | "module") {
  const notFound = kind === "cycle" ? "Cycle not found" : "Module not found";
  const middleware = async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const userId = c.get("userId");
    if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
    const id = c.req.param("id");
    if (!id) throw new HTTPException(400, { message: `Missing ${kind} id` });
    rejectNulByte(id, `${kind} id`);
    const row = await (kind === "cycle"
      ? findCycleScope(id)
      : findModuleScope(id));
    if (!row) throw new HTTPException(404, { message: notFound });
    try {
      await validateWorkspaceAccess(
        userId,
        row.workspaceId,
        c.get("apiKey")?.id,
      );
      setShadowLegacyAuthorization(c, "allowed");
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: notFound });
      }
      throw error;
    }
    const identity = await resolveCallerIdentity(c, userId);
    if (identity?.side === "staff") {
      const facts = await projectFacts(identity, row);
      if (!facts || !reaches(identity, facts))
        throw new HTTPException(404, { message: notFound });
    }
    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("projectId", row.projectId);
    // The project comes from the cycle or module's persisted row (strict project scope).
    c.set("policyScopeResource", "project");
    await next();
  };
  return markReach(middleware, { projectReach: true, resources: [kind] });
}

export const cycleRowReach = rowReach("cycle");
export const moduleRowReach = rowReach("module");
