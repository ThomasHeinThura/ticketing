/**
 * Hierarchy — pure functions, no I/O, no database import; see
 * `docs/01-architecture/monorepo-layout.md` § Package boundaries.
 *
 * `work_item.parent_id` (`relations-and-hierarchy.md` § Data) already has a race-free
 * cycle guard at the DATABASE layer — migration 0056's `work_item_reject_parent_cycle`
 * trigger, added by issue #188/PR #195. That trigger is the authoritative,
 * concurrency-safe backstop; it walks the proposed parent's ancestor chain with real row
 * locks (`FOR NO KEY UPDATE`) so two concurrent reparents can never race a cycle into
 * existence. What it does NOT do:
 *
 * 1. Give the API a clean, specific 4xx before the write — a caller who trips it gets a
 *    raw Postgres `RAISE EXCEPTION`, not a structured "self" vs "cycle" vs "max_depth"
 *    answer.
 * 2. Enforce `RH-7`'s depth-5 cap at all — the trigger's own migration comment says so
 *    explicitly ("depth-cap enforcement is a separate, not-yet-built concern").
 *
 * This module is that decision, factored out as a pure function so it can be tested
 * exhaustively without a database: the API route resolves the two facts a real graph
 * walk requires (the proposed parent's own ancestor chain, and the item's own deepest
 * existing descendant branch) via ordinary `work_item.parent_id` queries, then calls
 * `validateReparent` to decide before ever issuing the write. The database trigger keeps
 * running underneath, unmodified — this is a second, independent layer, not a
 * replacement for it (the same "two guards, two granularities" shape `schema.ts`'s own
 * `parentId` column comment documents for the self-parent CHECK vs. the cycle trigger).
 */
import type { ReparentValidationResult, WorkItemId } from "./types.js";

const DEFAULT_MAX_DEPTH = 5;

/**
 * Decides whether `itemId` may be reparented under `newParentId`, per `RH-7`/`RH-8`.
 *
 * @param itemId The work item being reparented.
 * @param newParentId The proposed new parent.
 * @param newParentAncestorChain The proposed parent's own ancestor chain, walked upward,
 *   STARTING WITH `newParentId` ITSELF and ending at the root (a work item with no
 *   parent). E.g. for `A <- B <- C` (C's parent is B, B's parent is A, A has no parent),
 *   reparenting some item under C passes `["C", "B", "A"]`. An item with no parent at all
 *   passes `[newParentId]` alone.
 * @param descendantDepthOfItem The item's own deepest existing branch, in hops: `0` when
 *   the item has no children; `1` when it has a child but no grandchild; and so on. Moving
 *   a subtree carries that subtree's own depth along with it (`RH-7` caps the RESULTING
 *   chain, not just the direct parent link).
 * @param maxDepth `RH-7`'s cap — defaults to 5, the spec's own number.
 */
export function validateReparent(
  itemId: WorkItemId,
  newParentId: WorkItemId,
  newParentAncestorChain: readonly WorkItemId[],
  descendantDepthOfItem: number,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): ReparentValidationResult {
  if (itemId === newParentId) {
    return { ok: false, reason: "self" };
  }

  // RH-8: "a work item cannot be its own ancestor, at any distance." The chain is the
  // proposed parent's own lineage; if the item being reparented already appears in it,
  // completing this reparent would make the item its own (indirect) descendant's
  // ancestor -- a cycle.
  if (newParentAncestorChain.includes(itemId)) {
    return { ok: false, reason: "cycle" };
  }

  // The proposed parent's own depth (root = 1) is its chain's length, since the chain
  // starts with the parent itself. The item's own resulting depth is one below that, and
  // the deepest node this reparent would place anywhere is the item's depth plus its own
  // subtree's deepest existing branch.
  const newParentDepth = newParentAncestorChain.length;
  const itemDepth = newParentDepth + 1;
  const deepestResultingDepth = itemDepth + descendantDepthOfItem;

  if (deepestResultingDepth > maxDepth) {
    return { ok: false, reason: "max_depth" };
  }

  return { ok: true };
}
