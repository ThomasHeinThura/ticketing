import {
  type ProjectReachFacts,
  type ResolvedIdentity,
  reaches,
} from "@taskdesk/permissions";
import { eq, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { projectFacts } from "../automation/access";
import db from "../database";
import { projectTable } from "../database/schema";
import { projectsWithFeature } from "../feature-flag/repository";
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
import type { PageActor } from "./audit";

export type PageCapability = "project:read" | "project:update";
export type PageScope = { workspaceId: string; projectId: string };

/** PG-2: every refusal that could reveal a page, a project or the feature is this one answer. */
export const PAGE_NOT_FOUND = "Not found";
const notFound = () => new HTTPException(404, { message: PAGE_NOT_FOUND });

/**
 * Project route (`/api/projects/{projectId}/pages...`). `projectId` is the project's id; its key
 * (slug) is accepted too. Pages are staff-only (PG-2): a customer or portal session, an
 * out-of-reach project and a missing project all answer the same constant-shape 404, decided
 * before anything about the project is looked up.
 */
async function resolvePagesProject(c: Context, next: Next) {
  markShadowLegacyAuthorizationUnknown(c);
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const raw = c.req.param("projectId");
  if (!raw) throw notFound();
  rejectNulByte(raw, "Project id");
  const identity = await resolveCallerIdentity(c, userId);
  if (identity?.side !== "staff") throw notFound();
  const [project] = await db
    .select({ id: projectTable.id, workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(or(eq(projectTable.id, raw), eq(projectTable.slug, raw)))
    .limit(1);
  if (!project) throw notFound();
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
      throw notFound();
    }
    throw error;
  }
  const facts = await projectFacts(identity, {
    workspaceId: project.workspaceId,
    projectId: project.id,
  });
  if (!facts || !reaches(identity, facts)) throw notFound();
  c.set("workspaceId", project.workspaceId);
  c.set("workspaceIdSource", "row");
  c.set("projectId", project.id);
  await next();
}

export const pagesProjectReach = markReach(resolvePagesProject, {
  projectReach: true,
  resources: ["project"],
});

/**
 * The caller's identity and project facts after reach is established, then the capability:
 * 404 for no reach (already decided by the middleware, re-checked here), 403 only for a staff
 * caller who reaches the project but lacks the capability.
 */
export async function authorisePages(
  c: Context,
  capability: PageCapability,
): Promise<{
  scope: PageScope;
  identity: ResolvedIdentity;
  facts: ProjectReachFacts;
  actor: PageActor;
  canEdit: boolean;
}> {
  const scope: PageScope = {
    workspaceId: c.get("workspaceId") as string,
    projectId: c.get("projectId") as string,
  };
  const identity = await resolveCallerIdentity(c, c.get("userId"));
  if (identity?.side !== "staff") throw notFound();
  const facts = await projectFacts(identity, scope);
  if (!facts || !reaches(identity, facts)) throw notFound();
  if (!hasProjectReadCapability(identity, capability, "project", facts))
    throw new HTTPException(403, { message: "Insufficient permissions" });
  // `feature.pages` off (default): the routes answer 404 `feature_disabled` like the agile gates;
  // rows are retained and return on re-enable. Decided after reach so it reveals nothing.
  const enabled = await projectsWithFeature(
    "feature.pages",
    scope.workspaceId,
    [scope.projectId],
  );
  if (enabled.length === 0)
    throw new HTTPException(404, { message: "feature_disabled" });
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    scope,
    identity,
    facts,
    canEdit: hasProjectReadCapability(
      identity,
      "project:update",
      "project",
      facts,
    ),
    actor: {
      userId: c.get("userId"),
      personId: identity.personId,
      actorType: apiKey ? "api_key" : "person",
      apiKeyId: apiKey?.id ?? null,
    },
  };
}
