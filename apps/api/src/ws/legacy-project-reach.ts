import { reaches } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import { markReach } from "../utils/reach-mark";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { reachableWorkspacePredicate } from "../utils/workspace-access-middleware";
import { checkWebSocketOrigin } from "./origin-policy";

/**
 * Whether the caller may hold a legacy project subscription (`/api/ws/{projectId}`) for this
 * project: the project exists (not soft-deleted), the caller reaches its workspace, and the
 * caller's resolved identity reaches the project itself (#745, same decision source as
 * #712/#730/#742: `reaches()` over the persisted project facts).
 *
 * An out-of-reach project, a project in another workspace and an unknown project all return
 * `false`; callers must answer all three identically. Used at upgrade time and again on every
 * re-authorisation, so a socket cannot outlive the reach it was opened with.
 *
 * The customer organisation is read from the PROJECT row (`rbac.md` step 6), not the workspace.
 */
export async function callerReachesLegacySocketProject(
  c: Context,
  userId: string,
  projectId: string,
): Promise<boolean> {
  // Resolved before the lookup, so a missing project costs the same work as a hidden one.
  const identity = await resolveCallerIdentity(c, userId);
  const [project] = await db
    .select({
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
    })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
        reachableWorkspacePredicate(
          schema.projectTable.workspaceId,
          userId,
          c.get("apiKey")?.id,
        ),
      ),
    )
    .limit(1);
  if (!project || !identity) return false;
  return reaches(identity, {
    projectId,
    workspaceId: project.workspaceId,
    organisationId: project.organisationId,
    ancestorProjectIds: [],
    ownerTeamId: null,
  });
}

/**
 * Upgrade-time gate for `GET /api/ws/{projectId}`: the origin policy, then PROJECT reach.
 * Origin is decided first, so a foreign page cannot use the status to learn what a victim
 * reaches. A project the caller cannot reach, one in another workspace and an unknown one all
 * answer the same 401 before any upgrade, so no subscription is created for any of them.
 * The reach mark is what the route guard requires of a delegated project socket route.
 */
export const requireLegacySocketProjectReach = markReach(
  async (c: Context, next: Next) => {
    const session = c.get("session") as { portal?: unknown } | null | undefined;
    const origin = checkWebSocketOrigin({
      host: c.req.header("Host") ?? null,
      origin: c.req.header("Origin") ?? null,
      sessionPortal: session?.portal,
      hasSession: c.get("session") !== null,
    });
    if (!origin.allowed) {
      throw new HTTPException(origin.status, { message: "Forbidden" });
    }
    const projectId = c.req.param("projectId") ?? "";
    // #281 sweep: this id reaches a raw `eq(projectTable.id, ...)` query, unvalidated -- a NUL
    // byte would otherwise 500 instead of a clean 400.
    rejectNulByte(projectId, "Project id");
    // #317 S1/S4: existence and reach are one lookup, so a foreign project and an unknown one
    // cost the same single project-table round trip.
    if (
      !(await callerReachesLegacySocketProject(c, c.get("userId"), projectId))
    ) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    await next();
  },
  { projectReach: true, resources: ["project"] },
);
