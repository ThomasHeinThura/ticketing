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
 * and never a project outside that. Reach is the SAME fact the rest of the app uses for
 * project membership (`membership` at `scope = 'project'` for the caller's person —
 * the roster rows assignment.md/`AS-5` is built on), plus the per-workspace `sees_all`
 * grant on a workspace-scoped membership row (#319/#334: `sees_all` is per workspace).
 * The option Thomas rejected was the opposite default — "restrict reads to owner, admin
 * or `sees_all`" — so a caller with no person row and no `sees_all` reaches nothing and
 * sees only non-project rows. That is the correct fail-closed end of the spectrum: the
 * filter can only ever show LESS than `workspace:manage_settings` alone would, never
 * more, and the `project_id IS NULL` arm is what keeps non-project rows (the audit-only
 * catalogue's own actions) visible to every authorized reader.
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
 * A caller with neither a person row nor `sees_all` gets `IN ()` collapsed to a filter
 * that matches only the `IS NULL` arm — fail-closed, and exactly the shape the
 * two-project test pins.
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
