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
 * (`@taskdesk/domain`'s `validateReparent`); for set-parent specifically, this walk now
 * runs under `hierarchy-lock.ts`'s per-project advisory lock, which closes the depth race
 * (Opus security review of PR #432, finding F1) -- the DB trigger remains the sole
 * race-free authority specifically for CYCLES, not depth (its own migration comment says
 * so explicitly) -- see `set-work-item-parent.ts`'s own doc comment for how the two
 * layers compose.
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

export type SubtreeResult = {
  rows: HierarchyNodeRow[];
  /** `true` when this result is a prefix, not the whole subtree -- see `MAX_TREE_NODES`. */
  truncated: boolean;
};

/**
 * Ordinary-review finding on this PR (medium severity): `relations-and-hierarchy.md`'s
 * own edge-cases table (line 120) says plainly "200 children on one parent -- The list
 * paginates; roll-up is computed in SQL." `RH-7` bounds DEPTH (5 levels), but nothing
 * bounded BREADTH -- a legitimately wide, non-cyclic subtree (many children, each with
 * few or no grandchildren of their own) could make `GET .../tree` construct and return an
 * arbitrarily large nested payload in one response, contradicting that edge case.
 *
 * Full cursor pagination (`api-design.md`'s convention, already used by `list-query.ts`)
 * does not translate cleanly onto a NESTED tree shape -- a cursor names a position in one
 * flat ordering, not "where you are across an arbitrary number of sibling groups at every
 * level simultaneously." Implementing that properly (paginating each parent's own
 * children independently, client-driven "load more children" per node) is real,
 * separate-scope work, not a small addition to this PR -- filed as a follow-up rather than
 * attempted here (see `get-work-item-tree.ts`'s own doc comment for the issue reference).
 *
 * This PR instead closes the actual gap the finding names -- an UNBOUNDED response -- with
 * a hard total-node cap. `500` is `list-query.ts`'s own `MAX_WORK_ITEM_LIST_LIMIT` (200,
 * the exact number the spec's own edge case names for a single parent's children) times
 * 2.5: generous enough that a genuinely modest, `RH-7`-depth-bounded tree (a few hundred
 * items across up to 5 levels, the normal service-desk range this spec targets) is never
 * truncated, while still keeping the worst case a bounded, predictable response size
 * instead of an open-ended one. `truncated: true` on the result means the caller received
 * a PREFIX of the real tree, not the whole thing -- surfaced to the API response
 * (`get-work-item-tree.ts`) so a client can show "showing the first N items" rather than
 * silently rendering a partial tree as if it were complete.
 */
export const MAX_TREE_NODES = 500;

/**
 * `GET /api/work-items/{key}/tree`'s data: every row of the SAME project reachable from
 * `rootId` downward (inclusive), each with the resolved `stateName`/`stateCategory` the
 * detail route already resolves for a single item (`get-work-item.ts`'s own join, same
 * shape). One query per level, same breadth-first shape as `descendantDepth`, bounded by
 * the same defensive `MAX_WALK_HOPS`, and now also by `MAX_TREE_NODES` (see its own
 * comment). `RH-6` (parent and child always share a project) is DB-enforced (`work_item`'s
 * composite self-FK, `schema.ts`), so every row this returns is already guaranteed to be
 * in `rootId`'s own project -- no separate project filter is needed to keep the tree from
 * crossing a project boundary.
 */
function selectHierarchyNodes(executor: DbOrTx) {
  return (
    executor
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
      )
      // Deterministic order (Opus security review of PR #432, finding F2): `position`
      // alone is not a real ordering here -- nothing in this codebase writes
      // `work_item.position` yet (`WI-11` ranking is unbuilt), so every row keeps its
      // `NOT NULL DEFAULT '0'` value and `.orderBy(position)` alone ties on every row,
      // making which rows survive `MAX_TREE_NODES`'s truncation arbitrary (Postgres's own
      // tie-break, which can change after an unrelated edit elsewhere in the table). The
      // codebase's own established rule for this -- `list-query.ts` lines 115-143's own
      // comment -- is that every sort needs an explicit tie-break column; `id` (a cuid2,
      // permanent and unique) is that tie-break here, the same role it plays there.
      .orderBy(workItemTable.position, workItemTable.id)
  );
}

export async function loadSubtreeRows(
  executor: DbOrTx,
  rootId: string,
): Promise<SubtreeResult> {
  const [rootRow] = await selectHierarchyNodes(executor).where(
    eq(workItemTable.id, rootId),
  );

  if (!rootRow) {
    return { rows: [], truncated: false };
  }

  const rows: HierarchyNodeRow[] = [rootRow];
  // BFS by `parent_id`, one level per query -- the same shape `descendantDepth` uses.
  // `frontier` holds the IDS of the level just added to `rows`; each iteration fetches
  // that level's CHILDREN (matching on `parent_id`, never re-matching the same ids on
  // `id`, which would refetch the same rows forever instead of descending).
  let frontier = [rootId];

  for (let hops = 0; hops < MAX_WALK_HOPS; hops++) {
    const remaining = MAX_TREE_NODES - rows.length;
    // Opus security review of PR #432, finding F3: without this `.limit`, a parent with
    // many more children than `remaining` would still load ALL of them into memory here
    // before the slice below ever runs -- the cap protected the RESPONSE size, not the
    // query's own memory/row-fetch cost. `remaining + 1` (not `remaining`) so the
    // `level.length > remaining` truncation check just below can still tell "exactly
    // enough children exist" apart from "more exist than fit" without a second query.
    const level = await selectHierarchyNodes(executor)
      .where(inArray(workItemTable.parentId, frontier))
      .limit(remaining + 1);

    if (level.length === 0) {
      return { rows, truncated: false };
    }

    if (level.length > remaining) {
      // This level alone would push the response past the cap. Keep only the first
      // `remaining` rows (in the deterministic `position` order the query above already
      // applies) and stop descending -- a node whose OWN row was cut cannot sensibly
      // carry children in the response either, so this is genuinely "return a prefix",
      // not "drop some leaves but keep their orphaned children".
      rows.push(...level.slice(0, remaining));
      return { rows, truncated: true };
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
