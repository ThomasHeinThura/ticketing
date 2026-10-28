import { sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { MAX_PROJECT_DEPTH } from "./hierarchy";

/**
 * Load the visible project subtree, including the requested root, in one bounded query.
 * Archived/deleted projects terminate traversal, so descendants below a hidden project do
 * not become visible through an ancestor board/report. Workspace predicates on both the
 * root and every recursive step keep malformed parent links tenant-local. The path guard
 * makes a corrupt cycle finite; the depth limit mirrors PR-1's four-level project tree.
 */
export async function loadVisibleProjectSubtreeIds(
  executor: Executor,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  const result = await executor.execute(sql`
    WITH RECURSIVE subtree(id, depth, path) AS (
      SELECT p.id, 1, ARRAY[p.id]::text[]
      FROM project p
      WHERE p.id = ${projectId}
        AND p.workspace_id = ${workspaceId}
        AND p.archived_at IS NULL
        AND p.deleted_at IS NULL

      UNION ALL

      SELECT child.id, subtree.depth + 1, subtree.path || child.id
      FROM subtree
      JOIN project child
        ON child.parent_id = subtree.id
       AND child.workspace_id = ${workspaceId}
      WHERE child.archived_at IS NULL
        AND child.deleted_at IS NULL
        AND subtree.depth < ${MAX_PROJECT_DEPTH}
        AND NOT (child.id = ANY(subtree.path))
    )
    SELECT id FROM subtree ORDER BY depth ASC, id ASC
  `);
  const rows = (
    Array.isArray(result)
      ? result
      : ((result as { rows?: unknown[] }).rows ?? [])
  ) as { id: string }[];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

/**
 * Batched form for project-list roll-ups. Each requested root receives its own
 * path-guarded traversal in one set-based recursive statement; duplicate descendants
 * are expected when one listed project is an ancestor of another.
 */
export async function loadVisibleProjectSubtrees(
  executor: Executor,
  workspaceId: string,
  rootProjectIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const id of rootProjectIds) result.set(id, []);
  if (rootProjectIds.length === 0) return result;

  const rowsResult = await executor.execute(sql`
    WITH RECURSIVE requested(root_id) AS (
      SELECT unnest(ARRAY[${sql.join(
        [...new Set(rootProjectIds)].map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])
    ), subtree(root_id, id, depth, path) AS (
      SELECT p.id, p.id, 1, ARRAY[p.id]::text[]
      FROM requested r
      JOIN project p
        ON p.id = r.root_id
       AND p.workspace_id = ${workspaceId}
      WHERE p.archived_at IS NULL
        AND p.deleted_at IS NULL

      UNION ALL

      SELECT subtree.root_id, child.id, subtree.depth + 1, subtree.path || child.id
      FROM subtree
      JOIN project child
        ON child.parent_id = subtree.id
       AND child.workspace_id = ${workspaceId}
      WHERE child.archived_at IS NULL
        AND child.deleted_at IS NULL
        AND subtree.depth < ${MAX_PROJECT_DEPTH}
        AND NOT (child.id = ANY(subtree.path))
    )
    SELECT root_id, id, depth
    FROM subtree
    ORDER BY root_id ASC, depth ASC, id ASC
  `);
  const rows = (
    Array.isArray(rowsResult)
      ? rowsResult
      : ((rowsResult as { rows?: unknown[] }).rows ?? [])
  ) as { root_id: string; id: string }[];
  const seenByRoot = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = result.get(row.root_id);
    if (!ids) continue;
    let seen = seenByRoot.get(row.root_id);
    if (!seen) {
      seen = new Set();
      seenByRoot.set(row.root_id, seen);
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return result;
}
