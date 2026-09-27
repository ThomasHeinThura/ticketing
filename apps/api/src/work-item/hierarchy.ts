import { eq, inArray } from "drizzle-orm";
import type db from "../database";
import {
  stateTable,
  stateTemplateTable,
  workItemTable,
} from "../database/schema";

/** Anything `db` or `db.transaction`'s callback argument can run a `select` through --
 * the same narrow shape `require-workspace-capability.ts`'s own `DbOrTx` uses. */
type DbOrTx = Pick<typeof db, "select">;

/**
 * `RH-7`'s own defensive bound, mirrored from `work_item_reject_parent_cycle`'s
 * `max_hops` (migration 0056's own comment): a real chain never legitimately exceeds
 * `RH-7`'s depth-5 cap, so this is pure defense-in-depth against data that is ALREADY
 * corrupt for some unrelated reason (rows written before any guard existed, or a bulk
 * import under `session_replication_role = replica`, which the trigger's own OS4 note
 * says bypasses it entirely) -- never expected to trip in ordinary operation.
 */
const MAX_WALK_HOPS = 1000;

/**
 * Walks `parent_id` upward from `startId` (inclusive), returning ids in the order
 * `[startId, its parent, its parent's parent, ..., the root]`. Stops at the first row
 * with a null parent. This is a PLAIN, unlocked read -- unlike the database trigger's own
 * walk (migration 0056), which takes `FOR NO KEY UPDATE` row locks because it runs
 * INSIDE the write transaction that changes `parent_id` and must be race-free against a
 * concurrent write. This walk only informs a PRE-write validation decision
 * (`@taskdesk/domain`'s `validateReparent`); the trigger remains the sole race-free
 * authority at write time -- see `set-work-item-parent.ts`'s own doc comment for how the
 * two layers compose.
 */
export async function ancestorChain(
  executor: DbOrTx,
  startId: string,
): Promise<string[]> {
  const chain: string[] = [startId];
  let currentId = startId;

  for (let hops = 0; hops < MAX_WALK_HOPS; hops++) {
    const [row] = await executor
      .select({ parentId: workItemTable.parentId })
      .from(workItemTable)
      .where(eq(workItemTable.id, currentId))
      .limit(1);

    if (!row || row.parentId === null) {
      return chain;
    }
    chain.push(row.parentId);
    currentId = row.parentId;
  }

  throw new Error(
    `ancestorChain: parent chain from ${startId} exceeds ${MAX_WALK_HOPS} hops -- ` +
      "refusing to walk further (data already inconsistent, or max depth badly violated)",
  );
}

/**
 * The deepest existing branch under `itemId`, in hops (`0` when `itemId` has no
 * children). Breadth-first, one query per level, so a wide-but-shallow subtree (many
 * children, no grandchildren) costs one extra query, not one per row.
 */
export async function descendantDepth(
  executor: DbOrTx,
  itemId: string,
): Promise<number> {
  let frontier = [itemId];
  let depth = 0;

  for (let hops = 0; hops < MAX_WALK_HOPS; hops++) {
    const rows = await executor
      .select({ id: workItemTable.id })
      .from(workItemTable)
      .where(inArray(workItemTable.parentId, frontier));

    if (rows.length === 0) {
      return depth;
    }
    depth += 1;
    frontier = rows.map((row) => row.id);
  }

  throw new Error(
    `descendantDepth: subtree under ${itemId} exceeds ${MAX_WALK_HOPS} hops -- ` +
      "refusing to walk further (data already inconsistent)",
  );
}

export type HierarchyNodeRow = {
  id: string;
  key: string;
  title: string;
  parentId: string | null;
  stateName: string;
  stateCategory: string;
};

/**
 * `GET /api/work-items/{key}/tree`'s data: every row of the SAME project reachable from
 * `rootId` downward (inclusive), each with the resolved `stateName`/`stateCategory` the
 * detail route already resolves for a single item (`get-work-item.ts`'s own join, same
 * shape). One query per level, same breadth-first shape as `descendantDepth`, bounded by
 * the same defensive `MAX_WALK_HOPS`. `RH-6` (parent and child always share a project) is
 * DB-enforced (`work_item`'s composite self-FK, `schema.ts`), so every row this returns is
 * already guaranteed to be in `rootId`'s own project -- no separate project filter is
 * needed to keep the tree from crossing a project boundary.
 */
function selectHierarchyNodes(executor: DbOrTx) {
  return executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      parentId: workItemTable.parentId,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    );
}

export async function loadSubtreeRows(
  executor: DbOrTx,
  rootId: string,
): Promise<HierarchyNodeRow[]> {
  const [rootRow] = await selectHierarchyNodes(executor).where(
    eq(workItemTable.id, rootId),
  );

  if (!rootRow) {
    return [];
  }

  const rows: HierarchyNodeRow[] = [rootRow];
  // BFS by `parent_id`, one level per query -- the same shape `descendantDepth` uses.
  // `frontier` holds the IDS of the level just added to `rows`; each iteration fetches
  // that level's CHILDREN (matching on `parent_id`, never re-matching the same ids on
  // `id`, which would refetch the same rows forever instead of descending).
  let frontier = [rootId];

  for (let hops = 0; hops < MAX_WALK_HOPS; hops++) {
    const level = await selectHierarchyNodes(executor).where(
      inArray(workItemTable.parentId, frontier),
    );

    if (level.length === 0) {
      return rows;
    }

    rows.push(...level);
    frontier = level.map((row) => row.id);
  }

  throw new Error(
    `loadSubtreeRows: tree rooted at ${rootId} exceeds ${MAX_WALK_HOPS} hops -- ` +
      "refusing to walk further (data already inconsistent)",
  );
}

/**
 * Finds the true root of `itemId`'s tree -- the ancestor at the top of its chain, or
 * `itemId` itself when it has no parent. No separate project/workspace filter is needed
 * here: `RH-6`'s composite self-FK on `work_item.parent_id` (`schema.ts`) guarantees
 * every row this walk visits shares `itemId`'s own `project_id`, and the route's own
 * reach middleware has already confirmed that project is reachable and not
 * soft-deleted before this ever runs.
 */
export async function findTreeRoot(
  executor: DbOrTx,
  itemId: string,
): Promise<string> {
  const chain = await ancestorChain(executor, itemId);
  return chain[chain.length - 1] ?? itemId;
}
