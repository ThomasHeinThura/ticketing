import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import {
  findTreeRoot,
  type HierarchyNodeRow,
  loadSubtreeRows,
} from "../hierarchy";

export type WorkItemTreeNode = {
  id: string;
  key: string;
  title: string;
  stateName: string;
  stateCategory: string;
  isCurrent: boolean;
  children: WorkItemTreeNode[];
};

/**
 * `GET /api/work-items/{key}/tree` (`work_item:read` -- `relations-and-hierarchy.md` §
 * Permissions). `require-work-item-reach.ts` has already resolved `key` to a row and
 * confirmed workspace reach on it, the same middleware `get-work-item.ts` relies on.
 *
 * "The tree of parent and children renders inline, with the current item highlighted"
 * (§ Screens): this finds the TRUE ROOT of `key`'s tree (walking up, `findTreeRoot`) and
 * returns the whole subtree from there down (`loadSubtreeRows`), with `isCurrent: true`
 * on the one node matching `key` -- "rooted at (or containing) this work item", per the
 * spec's own API table wording, means the caller sees the item in the context of its
 * FULL tree, not merely its own direct children.
 *
 * NO SEPARATE RE-SCOPING NEEDED: every row `loadSubtreeRows` can reach shares the root's
 * own `project_id` (`RH-6`'s composite self-FK on `work_item.parent_id`, `schema.ts`,
 * guarantees this at the database layer), and the root itself was reached by walking
 * UP from a row this route's own reach middleware already confirmed is in the caller's
 * workspace -- so the whole tree is inherently within the one project/workspace the
 * caller was already authorized against. This is what makes the route's reach check a
 * real, sufficient scoping mechanism for the entire response, not just its root node.
 */
export async function getWorkItemTree(
  key: string,
  workspaceId: string,
): Promise<WorkItemTreeNode> {
  const [item] = await db
    .select({ id: workItemTable.id })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!item) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  const rootId = await findTreeRoot(db, item.id);
  const rows = await loadSubtreeRows(db, rootId);

  return buildTree(rows, rootId, item.id);
}

/**
 * Assembles the flat, breadth-first `HierarchyNodeRow[]` `loadSubtreeRows` returns into a
 * nested tree, rooted at `rootId`. Every row's `parentId` either points at another row in
 * the same set (an internal node) or is absent from the set entirely (`rootId` itself,
 * whose own parent -- if any -- was deliberately not fetched; only the subtree FROM the
 * root down is loaded).
 */
function buildTree(
  rows: readonly HierarchyNodeRow[],
  rootId: string,
  currentId: string,
): WorkItemTreeNode {
  const nodes = new Map<string, WorkItemTreeNode>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        key: row.key,
        title: row.title,
        stateName: row.stateName,
        stateCategory: row.stateCategory,
        isCurrent: row.id === currentId,
        children: [],
      },
    ]),
  );

  for (const row of rows) {
    if (row.parentId === null || row.id === rootId) {
      continue;
    }
    const parentNode = nodes.get(row.parentId);
    const node = nodes.get(row.id);
    if (parentNode && node) {
      parentNode.children.push(node);
    }
  }

  const root = nodes.get(rootId);
  if (!root) {
    // `loadSubtreeRows(db, rootId)` always includes `rootId` itself as its first row --
    // reaching this would mean that row vanished between the two queries above (a
    // concurrent hard delete of the resolved root, which nothing in this codebase does
    // today). Fail loudly rather than return a malformed partial tree.
    throw new HTTPException(404, { message: "Work item not found" });
  }

  return root;
}

export default getWorkItemTree;
