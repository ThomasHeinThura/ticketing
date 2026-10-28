import {
  can,
  type ProjectReachFacts,
  type ResolvedIdentity,
  reaches,
} from "@taskdesk/permissions";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable } from "../database/schema";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
import { callerReach } from "../utils/caller-reach";
import {
  hasProjectReadCapability,
  resolveCallerIdentity,
} from "../utils/has-project-reach";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import { markReach } from "../utils/reach-mark";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { receivesEverything } from "../webhook/reach";
import type { ReaderVisibility } from "./visibility";

/**
 * Authorisation for automation routes. The contract's capabilities are a union
 * ("`project:manage_settings` | `workspace:manage_settings`"), which a single route policy cannot
 * express, so the runtime decides by the rule's own scope:
 *
 * - a **workspace rule** (`project_id` null) needs `workspace:manage_settings` for everything,
 *   reading included;
 * - a **project rule** needs `automation:manage` to change, and `project:read` to list or
 *   read run history, evaluated at the project (so inherited project authority applies) after the
 *   caller's reach to that project is established. An unreachable project answers `404`.
 *
 * A customer is never an author or reader of rules.
 */

export type RuleScope = { workspaceId: string; projectId: string | null };

export type AccessMode = "read" | "manage";

async function staffIdentity(c: Context): Promise<ResolvedIdentity> {
  const identity = await resolveCallerIdentity(c, c.get("userId"));
  if (identity?.side !== "staff")
    throw new HTTPException(403, { message: "Insufficient permissions" });
  return identity;
}

export async function projectFacts(
  identity: ResolvedIdentity,
  scope: { workspaceId: string; projectId: string },
): Promise<ProjectReachFacts | null> {
  const [project] = await db
    .select({
      workspaceId: projectTable.workspaceId,
      organisationId: projectTable.organisationId,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, scope.projectId))
    .limit(1);
  // A soft-deleted project is not found (the repo convention: require-active-project.ts).
  if (
    !project ||
    project.deletedAt !== null ||
    project.workspaceId !== scope.workspaceId
  )
    return null;
  return {
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    organisationId: project.organisationId,
    ancestorProjectIds: await projectAncestryFor(
      db,
      identity,
      scope.workspaceId,
      scope.projectId,
    ),
    ownerTeamId: await projectOwnerTeamFor(
      db,
      identity,
      scope.workspaceId,
      scope.projectId,
    ),
  };
}

/** Ancestor projects (nearest first) a project rule's author ceiling inherits through; none for a workspace rule. */
export async function ruleAncestryFor(
  identity: ResolvedIdentity,
  scope: RuleScope,
): Promise<string[]> {
  if (scope.projectId === null) return [];
  return [
    ...(await projectAncestryFor(
      db,
      identity,
      scope.workspaceId,
      scope.projectId,
    )),
  ];
}

/** Throws unless the caller may act on rules in this scope; returns the caller's identity. */
export async function authoriseRuleScope(
  c: Context,
  scope: RuleScope,
  mode: AccessMode,
): Promise<ResolvedIdentity> {
  const identity = await staffIdentity(c);
  if (scope.projectId === null) {
    if (
      !can(identity, "workspace:manage_settings", "workspace", {
        workspaceId: scope.workspaceId,
      })
    )
      throw new HTTPException(403, { message: "Insufficient permissions" });
    return identity;
  }
  const facts = await projectFacts(identity, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  });
  if (!facts || !reaches(identity, facts))
    throw new HTTPException(404, { message: "Not found" });
  const capability = mode === "manage" ? "automation:manage" : "project:read";
  if (!hasProjectReadCapability(identity, capability, "project", facts))
    throw new HTTPException(403, { message: "Insufficient permissions" });
  return identity;
}

/** The projects the reader reaches, for filtering a workspace rule's history and dry-run. */
export async function readerVisibility(
  c: Context,
  identity: ResolvedIdentity,
  workspaceId: string,
  resolvedReach?: Awaited<ReturnType<typeof callerReach>>,
): Promise<ReaderVisibility> {
  const reach = resolvedReach ?? (await callerReach(c, c.get("userId")));
  return {
    projectIds: new Set(await reach.reachableProjectIds([workspaceId])),
    everything: receivesEverything(identity, workspaceId),
  };
}

/** Workspace route (`/api/workspaces/{id}/...`): membership, then the route's own authority. */
export async function workspaceFromIdParam(c: Context, next: Next) {
  markShadowLegacyAuthorizationUnknown(c);
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const raw = c.req.param("id");
  if (!raw) throw new HTTPException(400, { message: "Missing workspace id" });
  rejectNulByte(raw, "Workspace id");
  try {
    await validateWorkspaceAccess(userId, raw, c.get("apiKey")?.id);
    setShadowLegacyAuthorization(c, "allowed");
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      setShadowLegacyAuthorization(c, "denied");
    throw error;
  }
  c.set("workspaceId", raw);
  c.set("workspaceIdSource", "request");
  await next();
}

/**
 * Project route (`/api/projects/{key}/...`): `key` is the project's key (its unique slug); the id
 * is accepted too, so a client holding either resolves the same project. Out-of-reach and missing
 * answer the same `404`.
 */
async function resolveProjectFromKeyParam(c: Context, next: Next) {
  markShadowLegacyAuthorizationUnknown(c);
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const raw = c.req.param("key");
  if (!raw) throw new HTTPException(400, { message: "Missing project key" });
  rejectNulByte(raw, "Project key");
  const [project] = await db
    .select({
      id: projectTable.id,
      workspaceId: projectTable.workspaceId,
    })
    .from(projectTable)
    .where(
      and(
        or(eq(projectTable.slug, raw), eq(projectTable.id, raw)),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  try {
    await validateWorkspaceAccess(
      userId,
      project.workspaceId,
      c.get("apiKey")?.id,
    );
    setShadowLegacyAuthorization(c, "allowed");
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(404, { message: "Project not found" });
    }
    throw error;
  }
  // Project reach, not just workspace membership: an out-of-reach project answers exactly
  // like a missing one. A non-staff caller falls through to the handler's own 403.
  const identity = await resolveCallerIdentity(c, userId);
  if (identity?.side === "staff") {
    const facts = await projectFacts(identity, {
      workspaceId: project.workspaceId,
      projectId: project.id,
    });
    if (!facts || !reaches(identity, facts))
      throw new HTTPException(404, { message: "Project not found" });
  }
  c.set("workspaceId", project.workspaceId);
  c.set("workspaceIdSource", "row");
  c.set("projectId", project.id);
  // The project was resolved from its persisted row, which is what strict project scope needs.
  c.set("policyScopeResource", "project");
  await next();
}

export const projectFromKeyParam = markReach(resolveProjectFromKeyParam, {
  projectReach: true,
  resources: ["project"],
});
