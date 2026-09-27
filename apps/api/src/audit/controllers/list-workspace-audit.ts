import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import {
  auditLogTable,
  membershipTable,
  personTable,
} from "../../database/schema";
import {
  type AuditQuery,
  auditListFilters,
  combineFilters,
  writeAuditRead,
} from "./audit-read-common";

/**
 * `GET /api/workspaces/{workspaceId}/audit` — AU-10: workspace administrators see
 * their workspace's rows. The route's middleware chain
 * (`workspaceAccess.fromParam` → `requireWorkspaceMembership` →
 * `requireWorkspaceCapability("workspace:manage_settings")`) has already proven
 * membership and the canonical capability by the time this runs; this handler's own
 * job is the tenant filter, applied unconditionally — the query never sees another
 * workspace's rows even if a future refactor drops a middleware. AU-13 applies.
 *
 * REACH FILTER (#344, Thomas 2026-09-23 — recorded in the decision log). Holding
 * `workspace:manage_settings` is not, by itself, reach on every PROJECT in the
 * workspace: a manager sees non-project rows plus the rows of projects they can reach,
 * and never a project outside that.
 *
 * WHAT "REACH" IS HERE, PRECISELY. The filter reads `membership` rows at
 * `scope = 'project'` for the caller's person — the roster model the assignment feature
 * is built on (`AS-5`, the assignable feed) — plus the per-workspace `sees_all` grant
 * on a workspace-scoped `membership` row (#319/#334). The ordinary review of PR #375
 * (finding 2) is right that this is NOT yet the same fact the app's other routes use
 * live: those check `workspace_user` membership (`workspace-access-middleware.ts`),
 * while `membership` at project scope currently has no production WRITER — only the
 * seeds and tests. The consequence is deliberately one-directional and recorded rather
 * than papered over: until a writer populates project memberships, a reader can be
 * UNDER-exposed (a project legitimately theirs, invisible because no `membership` row
 * exists), never over-exposed, because the filter can only ever show LESS than
 * `workspace:manage_settings` alone would. rbac.md's reach steps beyond membership
 * (hierarchy, owner-team) are not consulted either; these are #8's runtime-integration
 * scope and the filter follows the same single source when that lands, rather than
 * inventing a second reach model here.
 *
 * The option Thomas rejected was the opposite default — "restrict reads to owner, admin
 * or `sees_all`" — so a caller with no reachable projects (no person row, or a person
 * with no project memberships) sees exactly the non-project rows, never a project's.
 * Every branch below therefore fails CLOSED, and each is pinned by its own test in
 * `audit-read.test.ts` (the ordinary review of PR #375 found the empty-reachable-set
 * branch unpinned; it has one now).
 */
export async function listWorkspaceAudit(
  c: Context,
  workspaceId: string,
  query: AuditQuery,
) {
  const reachFilter = await projectReachFilter(c, workspaceId);
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(
      combineFilters([
        eq(auditLogTable.workspaceId, workspaceId),
        reachFilter,
        ...auditListFilters(query),
      ]),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);

  await writeAuditRead(c, { workspaceId });
  return rows;
}

/**
 * `project_id IS NULL OR project_id IN (reachable)` — or `undefined` (no constraint)
 * when the caller holds the per-workspace `sees_all` grant, which by #319/#334 is the
 * grant that means "every project in THIS workspace".
 *
 * Two reads, both keyed to facts other routes already treat as authoritative:
 *   - the caller's person (`person.user_id`, unique by `person_user_unique`);
 *   - their project memberships on rows where `sees_all` is set at workspace scope.
 * A caller with neither a person row nor `sees_all` gets a filter that matches only the
 * `IS NULL` arm — fail-closed. The two-project test pins the NON-empty branch (a
 * reader with one project membership), and a dedicated test pins this empty one; the
 * two are deliberately separate, because a single test cannot catch a regression that
 * only affects the other.
 */
async function projectReachFilter(
  c: Context,
  workspaceId: string,
): Promise<SQL | undefined> {
  const userId = c.get("userId") as string | undefined;
  if (userId === undefined) {
    // The middleware chain has already required membership; a missing user id here is
    // a programmer error, and fail-closed is the only safe reading of it.
    return isNull(auditLogTable.projectId);
  }

  const [person] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);

  if (person === undefined) {
    return isNull(auditLogTable.projectId);
  }

  const [seesAll] = await db
    .select({ personId: membershipTable.personId })
    .from(membershipTable)
    .where(
      and(
        eq(membershipTable.personId, person.id),
        eq(membershipTable.scope, "workspace"),
        eq(membershipTable.scopeId, workspaceId),
        eq(membershipTable.seesAll, true),
      ),
    )
    .limit(1);

  if (seesAll !== undefined) {
    return undefined;
  }

  const reachable = (
    await db
      .select({ projectId: membershipTable.scopeId })
      .from(membershipTable)
      .where(
        and(
          eq(membershipTable.personId, person.id),
          eq(membershipTable.scope, "project"),
        ),
      )
  ).map((row) => row.projectId);

  return reachable.length === 0
    ? isNull(auditLogTable.projectId)
    : or(
        isNull(auditLogTable.projectId),
        inArray(auditLogTable.projectId, reachable),
      );
}
