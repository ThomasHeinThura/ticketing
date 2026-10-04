import { eq, inArray } from "drizzle-orm";
import type db from "../database";
import { workItemTable } from "../database/schema";

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
