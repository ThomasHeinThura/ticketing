export type WorkItemId = string;

/**
 * Why `validateReparent` refused a proposed parent — `relations-and-hierarchy.md`:
 *
 * - `"self"` — `RH-8`'s distance-0 case: a work item set as its own parent.
 * - `"cycle"` — `RH-8`'s general case: the proposed parent's own ancestor chain already
 *   contains the item, at any distance greater than zero.
 * - `"max_depth"` — `RH-7`: the resulting chain (proposed parent's own depth, plus the
 *   item, plus the deepest branch of the item's existing subtree) would exceed the cap.
 */
export type ReparentRejectionReason = "self" | "cycle" | "max_depth";

export type ReparentValidationResult =
  | { ok: true }
  | { ok: false; reason: ReparentRejectionReason };
