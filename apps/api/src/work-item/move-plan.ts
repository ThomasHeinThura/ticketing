/**
 * Pure planning rules for a cross-project move (`RH-12`). No I/O: every function here is unit
 * tested without a database; `controllers/move-work-item.ts` supplies the persisted facts and
 * applies the result inside one locked transaction.
 *
 * Documented rules (also stated in `docs/technical/feature-contracts-p1.md` under RH-12):
 * - The moved item's own parent link is always removed: `RH-6` requires parent and child to share a
 *   project, and the former parent stays behind.
 * - `moveChildren: true` moves the item's whole subtree (every descendant, including archived and
 *   soft-deleted rows, because their `parent_id` keeps pointing inside the tree).
 *   `moveChildren: false` detaches the direct children (they stay in the old project with no
 *   parent); grandchildren keep their own parents.
 * - States are remapped by `state.state_template_id` to the target project's live state of the same
 *   template. A template the target project does not use refuses the whole move (422); nothing is
 *   silently reset to another state.
 * - Workspace-wide labels stay; project-scoped labels move to the target project's label with the
 *   same name, and are dropped when the target has none.
 */

export const MAX_MOVE_SUBTREE = 200;

export type MoveStateFact = {
  id: string;
  stateTemplateId: string;
  position: number;
  archivedAt: Date | null;
};

export type StateMapping =
  | { ok: true; map: Map<string, string> }
  | { ok: false; unmappedStateIds: string[] };

/**
 * Maps each source state id to a target state id with the same template. When the target has
 * several live states of one template the lowest `position`, then lowest id, wins so the choice is
 * deterministic. Archived target states are never chosen.
 */
export function planStateMapping(
  sourceStateIds: readonly string[],
  sourceStates: readonly MoveStateFact[],
  targetStates: readonly MoveStateFact[],
): StateMapping {
  const byTemplate = new Map<string, MoveStateFact>();
  for (const state of [...targetStates]
    .filter((candidate) => candidate.archivedAt === null)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    if (!byTemplate.has(state.stateTemplateId))
      byTemplate.set(state.stateTemplateId, state);
  }
  const sourceById = new Map(sourceStates.map((state) => [state.id, state]));
  const map = new Map<string, string>();
  const unmapped: string[] = [];
  for (const id of new Set(sourceStateIds)) {
    const source = sourceById.get(id);
    const target = source ? byTemplate.get(source.stateTemplateId) : undefined;
    if (target) map.set(id, target.id);
    else unmapped.push(id);
  }
  return unmapped.length
    ? { ok: false, unmappedStateIds: unmapped.sort() }
    : { ok: true, map };
}

export type AssignedLabelFact = {
  id: string;
  name: string;
  projectId: string | null;
};

export type TargetLabelFact = { id: string; name: string };

export type LabelPlan = {
  /** Label ids the item holds after the move, sorted. */
  after: string[];
  /** Project-scoped labels with no equivalent in the target project. */
  dropped: string[];
  /** Project-scoped labels replaced by the target project's label of the same name. */
  remapped: Array<{ from: string; to: string }>;
};

export function planLabelMove(
  assigned: readonly AssignedLabelFact[],
  targetProjectLabels: readonly TargetLabelFact[],
): LabelPlan {
  const byName = new Map(
    targetProjectLabels.map((label) => [label.name, label.id]),
  );
  const after = new Set<string>();
  const dropped: string[] = [];
  const remapped: Array<{ from: string; to: string }> = [];
  for (const label of assigned) {
    if (label.projectId === null) {
      after.add(label.id);
      continue;
    }
    const replacement = byName.get(label.name);
    if (replacement) {
      after.add(replacement);
      remapped.push({ from: label.id, to: replacement });
    } else dropped.push(label.id);
  }
  return {
    after: [...after].sort(),
    dropped: dropped.sort(),
    remapped: remapped.sort((a, b) => a.from.localeCompare(b.from)),
  };
}

export type MoveTreeRow = {
  id: string;
  parentId: string | null;
  number: number;
};

/** Ids of the root plus every descendant reachable through `parentId`, in a stable order. */
export function collectSubtree(
  rows: readonly MoveTreeRow[],
  rootId: string,
): string[] {
  const children = new Map<string, MoveTreeRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row);
    children.set(row.parentId, list);
  }
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const child of children.get(queue[index] as string) ?? []) {
      if (seen.has(child.id)) continue; // a corrupt cycle must not loop forever
      seen.add(child.id);
      queue.push(child.id);
    }
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...seen].sort(
    (a, b) =>
      (byId.get(a)?.number ?? 0) - (byId.get(b)?.number ?? 0) ||
      a.localeCompare(b),
  );
}

export type MoveRefusal =
  | { code: "same_project" }
  | { code: "too_large"; size: number }
  | { code: "organisation_exposure" }
  | { code: "assignee_ineligible"; personIds: string[] };

export type CustomerExposureFacts = {
  requesterId: string | null;
  customerVisibility: string;
};

/**
 * A move across customer organisations would otherwise hand a requester's item, or an item
 * marked organisation-visible, to a different customer's portal reach. Moving inside one
 * organisation (or between internal projects) is unaffected.
 */
export function exposesAcrossOrganisations(
  sourceOrganisationId: string | null,
  targetOrganisationId: string | null,
  rows: readonly CustomerExposureFacts[],
): boolean {
  if (sourceOrganisationId === targetOrganisationId) return false;
  return rows.some(
    (row) => row.requesterId !== null || row.customerVisibility !== "private",
  );
}

export function checkMoveSize(
  size: number,
): Extract<MoveRefusal, { code: "too_large" }> | null {
  return size > MAX_MOVE_SUBTREE ? { code: "too_large", size } : null;
}

export function movedKey(slug: string, number: number): string {
  return `${slug}-${number}`;
}

/**
 * Moved rows are appended to the bottom of each target state column, preserving their relative
 * order. `rows` must arrive already ordered by `(position, id)` (the loader sorts in SQL, where
 * `numeric(20,10)` compares exactly); this returns each row's 1-based ordinal within its mapped
 * state. The writer adds the column's current maximum position in SQL, so the numeric value never
 * passes through a JS number.
 */
export function planPositionOrdinals(
  rows: ReadonlyArray<{ id: string; stateId: string }>,
): Map<string, number> {
  const counters = new Map<string, number>();
  const ordinals = new Map<string, number>();
  for (const row of rows) {
    const value = (counters.get(row.stateId) ?? 0) + 1;
    counters.set(row.stateId, value);
    ordinals.set(row.id, value);
  }
  return ordinals;
}
