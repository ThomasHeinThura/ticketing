import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { membershipTable, projectTable } from "../database/schema";
import {
  MAX_PROJECT_DEPTH,
  type ProjectParentMap,
  reachAncestorIds,
} from "./hierarchy";

/**
 * Serialises hierarchy writes per workspace. Depth and cycle checks read every project's
 * parent and then write one row; without this two concurrent re-parentings could each pass
 * the check and together create a cycle or a fifth level. Distinct key (1527) from the
 * project-ordering lock (1524), so a create does not wait on a re-parent.
 */
export async function lockProjectHierarchy(
  executor: Executor,
  workspaceId: string,
) {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(1527, hashtext(${workspaceId}))`,
  );
}

/** `id -> parent_id` for every project row of one workspace (archived and deleted included:
 * the row still exists and still occupies its level until purged). */
export async function loadWorkspaceParentMap(
  executor: Executor,
  workspaceId: string,
): Promise<ProjectParentMap> {
  const rows = await executor
    .select({ id: projectTable.id, parentId: projectTable.parentId })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));
  return new Map(rows.map((row) => [row.id, row.parentId]));
}

/** `id -> parent_id` plus the soft-deleted ids of one workspace, for reach ancestry. */
export async function loadWorkspaceAncestry(
  executor: Executor,
  workspaceId: string,
) {
  const rows = await executor
    .select({
      id: projectTable.id,
      parentId: projectTable.parentId,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));
  const parents: ProjectParentMap = new Map(
    rows.map((row) => [row.id, row.parentId]),
  );
  const deleted = new Set(
    rows.filter((row) => row.deletedAt !== null).map((row) => row.id),
  );
  return { parents, deleted };
}

/**
 * Ancestor project ids of `projectId`, nearest first -- the value the reach evaluator's
 * `ProjectReachFacts.ancestorProjectIds` (reach step 4, "membership of an ancestor project",
 * `PR-2`) and `ScopeTarget.ancestorProjectIds` (inherited authority, `PR-3`) expect.
 *
 * One bounded recursive CTE for this project's chain only (never every project row of the
 * workspace), mirroring the SQL reach predicate in `identity-scope.repository.ts` and
 * `reachAncestorIds`: same workspace only (tenant boundary), the walk stops at a soft-deleted
 * ancestor (it and everything above it grant nothing), at a stored cycle, and at the depth cap
 * (`MAX_PROJECT_DEPTH` levels, so at most `MAX_PROJECT_DEPTH - 1` ancestors).
 * `projectId` itself is never in the result.
 */
export async function loadProjectAncestorIds(
  executor: Executor,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  const result = await executor.execute(sql`
    WITH RECURSIVE chain(id, parent_id, depth) AS (
      SELECT p.id, p.parent_id, 1
      FROM ${projectTable} AS p
      WHERE p.id = ${projectId} AND p.workspace_id = ${workspaceId}
      UNION ALL
      SELECT n.id, n.parent_id, chain.depth + 1
      FROM ${projectTable} AS n
      INNER JOIN chain ON n.id = chain.parent_id
      WHERE n.workspace_id = ${workspaceId}
        AND n.deleted_at IS NULL
        AND chain.depth < ${sql.raw(String(MAX_PROJECT_DEPTH))}
    )
    SELECT id FROM chain WHERE depth > 1 ORDER BY depth ASC
  `);
  const rows = (
    Array.isArray(result)
      ? result
      : ((result as { rows?: unknown[] }).rows ?? [])
  ) as { id: string }[];
  const out: string[] = [];
  const seen = new Set<string>([projectId]);
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row.id);
  }
  return out;
}

const requestAncestors = new WeakMap<object, Map<string, Promise<string[]>>>();

/**
 * A handle that outlives a request: an executor (`execute`/`select`) that is not a
 * transaction (a Drizzle transaction carries `rollback`). The shared `db` / pool is the
 * case that matters. Memoising on it would never be evicted, so a re-parent or an ancestor
 * soft-delete would keep granting inherited authority from the old chain (review Q1).
 */
function isLongLivedExecutor(request: object): boolean {
  const handle = request as {
    execute?: unknown;
    select?: unknown;
    rollback?: unknown;
  };
  return (
    typeof handle.execute === "function" &&
    typeof handle.select === "function" &&
    typeof handle.rollback !== "function"
  );
}

/** Drops every memoised chain for `request` (a request context or a transaction). */
export function invalidateProjectAncestry(request: object): void {
  requestAncestors.delete(request);
}

/**
 * `loadProjectAncestorIds`, memoised on the request context or transaction so the several
 * layers of one request (workspace middleware, strict policy enforcement, work-item reach,
 * comment and attachment access) share one query per project. A failed load is not cached.
 * A long-lived executor (the global `db`) is never a memo key: such a call always reads the
 * current chain.
 */
export function loadProjectAncestorIdsForRequest(
  request: object,
  executor: Executor,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  if (isLongLivedExecutor(request))
    return loadProjectAncestorIds(executor, workspaceId, projectId);
  let cache = requestAncestors.get(request);
  if (!cache) {
    cache = new Map();
    requestAncestors.set(request, cache);
  }
  const key = `${workspaceId}:${projectId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = loadProjectAncestorIds(executor, workspaceId, projectId);
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}

/**
 * Whether inherited reach or authority could matter for this caller on this project: only a
 * project-scope membership or role grant on some OTHER project can ever be inherited. A caller
 * with none (workspace role only, instance admin, customer) never needs the chain, and a
 * caller whose only project rows are on the target itself is decided by the direct grant.
 */
export function mayInheritProjectAccess(
  identity: Pick<ResolvedIdentity, "memberships" | "authority" | "side">,
  projectId: string,
): boolean {
  if (identity.side === "customer") return false;
  // A malformed identity (no rows to inspect) is never assumed to be inheritance-free.
  if (
    !Array.isArray(identity.memberships) ||
    !Array.isArray(identity.authority)
  )
    return true;
  return (
    identity.memberships.some(
      (m) => m.scope === "project" && m.scopeId !== projectId,
    ) ||
    identity.authority.some(
      (g) => g.scope === "project" && g.scopeId !== projectId,
    )
  );
}

/**
 * Ancestors for an identity: `[]` without a query when nothing could be inherited
 * (`mayInheritProjectAccess`), otherwise the request-memoised chain.
 */
export async function loadProjectAncestorIdsFor(
  request: object,
  executor: Executor,
  identity: Pick<ResolvedIdentity, "memberships" | "authority" | "side">,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  if (!mayInheritProjectAccess(identity, projectId)) return [];
  return loadProjectAncestorIdsForRequest(
    request,
    executor,
    workspaceId,
    projectId,
  );
}

/**
 * Ancestor ids for many projects across workspaces in one query: `projectId -> ancestors`.
 * Used by the reach-filtered project list. Projects without ancestors map to `[]`.
 */
export async function loadAncestorIdsByProject(
  executor: Executor,
  workspaceIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (workspaceIds.length === 0) return out;
  const rows = await executor
    .select({
      id: projectTable.id,
      parentId: projectTable.parentId,
      workspaceId: projectTable.workspaceId,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(inArray(projectTable.workspaceId, [...workspaceIds]));
  const byWorkspace = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byWorkspace.get(row.workspaceId);
    if (list) list.push(row);
    else byWorkspace.set(row.workspaceId, [row]);
  }
  for (const list of byWorkspace.values()) {
    const parents: ProjectParentMap = new Map(
      list.map((row) => [row.id, row.parentId]),
    );
    const deleted = new Set(
      list.filter((row) => row.deletedAt !== null).map((row) => row.id),
    );
    for (const row of list) {
      out.set(row.id, reachAncestorIds(parents, deleted, row.id));
    }
  }
  return out;
}

export async function setProjectParent(
  executor: Executor,
  projectId: string,
  parentId: string | null,
) {
  const [row] = await executor
    .update(projectTable)
    .set({ parentId })
    .where(eq(projectTable.id, projectId))
    .returning();
  // The chain memoised on this transaction (if any) is now stale.
  invalidateProjectAncestry(executor);
  return row;
}

/** A live (not soft-deleted) project row of the workspace, or undefined. */
export async function findLiveProject(
  executor: Executor,
  workspaceId: string,
  projectId: string,
) {
  const [row] = await executor
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

/** Whether the project has a child that is neither archived nor soft-deleted. */
export async function hasActiveChildren(
  executor: Executor,
  workspaceId: string,
  projectId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        eq(projectTable.parentId, projectId),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** PR-7: how many project-scope roster rows the project has. */
export async function countProjectRosterRows(
  executor: Executor,
  projectId: string,
): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(membershipTable)
    .where(
      and(
        eq(membershipTable.scope, "project"),
        eq(membershipTable.scopeId, projectId),
      ),
    );
  return row?.n ?? 0;
}
