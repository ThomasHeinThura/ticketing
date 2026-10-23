/**
 * Project hierarchy rules (`projects-and-engagements.md` `PR-1`): a project has at most one
 * parent and the tree is at most four levels deep. Pure functions over a `child -> parent`
 * map so the rules are unit-testable without a database; the write path
 * (`controllers/update-project-ownership.ts`) loads the workspace's edges under a workspace
 * advisory lock and applies them.
 *
 * Depth counts levels: a root project is level 1, so "4-level hierarchy with a 5th
 * attempted" (edge-case table) is refused.
 */

export const MAX_PROJECT_DEPTH = 4;

/** `child project id -> parent project id | null` for every project in one workspace. */
export type ProjectParentMap = ReadonlyMap<string, string | null>;

export type ReparentRefusal =
  | "parent_not_found"
  | "parent_is_self"
  | "parent_is_descendant"
  | "depth_exceeded";

/** Level of `projectId` (root = 1). A cycle in stored data returns `Infinity`. */
export function projectLevel(
  parents: ProjectParentMap,
  projectId: string,
): number {
  let level = 1;
  const seen = new Set<string>([projectId]);
  let cursor = parents.get(projectId) ?? null;
  while (cursor !== null) {
    if (seen.has(cursor)) return Number.POSITIVE_INFINITY;
    seen.add(cursor);
    level += 1;
    cursor = parents.get(cursor) ?? null;
  }
  return level;
}

/** Number of levels in the subtree rooted at `projectId`, including itself (leaf = 1). */
export function subtreeHeight(
  parents: ProjectParentMap,
  projectId: string,
): number {
  const children = new Map<string, string[]>();
  for (const [child, parent] of parents) {
    if (parent === null) continue;
    const list = children.get(parent);
    if (list) list.push(child);
    else children.set(parent, [child]);
  }
  let height = 1;
  const stack: Array<{ id: string; level: number }> = [
    { id: projectId, level: 1 },
  ];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    height = Math.max(height, next.level);
    for (const child of children.get(next.id) ?? []) {
      stack.push({ id: child, level: next.level + 1 });
    }
  }
  return height;
}

/** Every descendant id of `projectId` (not including itself). */
export function descendantProjectIds(
  parents: ProjectParentMap,
  projectId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const [child, parent] of parents) {
    if (parent === null) continue;
    const list = children.get(parent);
    if (list) list.push(child);
    else children.set(parent, [child]);
  }
  const out: string[] = [];
  const seen = new Set<string>([projectId]);
  const stack = [...(children.get(projectId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/**
 * Whether moving `projectId` under `newParentId` (or to the root when null) is allowed.
 * The moved subtree travels with the project, so the check is the new parent's level plus
 * the subtree's own height -- checking the node alone would let a deep subtree overflow.
 */
export function checkReparent(
  parents: ProjectParentMap,
  projectId: string,
  newParentId: string | null,
): ReparentRefusal | null {
  if (newParentId === null) return null;
  if (newParentId === projectId) return "parent_is_self";
  if (!parents.has(newParentId)) return "parent_not_found";
  if (descendantProjectIds(parents, projectId).includes(newParentId)) {
    return "parent_is_descendant";
  }
  const total =
    projectLevel(parents, newParentId) + subtreeHeight(parents, projectId);
  return total > MAX_PROJECT_DEPTH ? "depth_exceeded" : null;
}

/**
 * Ancestor project ids of `projectId`, nearest first, as the reach evaluator's
 * `ProjectReachFacts.ancestorProjectIds` expects (`PR-2`, reach step 4).
 *
 * Conservative on purpose -- inherited reach must never exceed what the contract states:
 * - the walk only follows parents that exist in `parents` (one workspace's rows), so a parent
 *   id pointing outside the workspace is never returned (tenant boundary);
 * - the walk stops at a soft-deleted ancestor, so a deleted project grants nothing to its
 *   descendants, nor does anything above it;
 * - it stops on a stored cycle and at the depth cap.
 * `projectId` itself is never in the result.
 */
export function reachAncestorIds(
  parents: ProjectParentMap,
  deletedIds: ReadonlySet<string>,
  projectId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([projectId]);
  let cursor = parents.get(projectId) ?? null;
  while (
    cursor !== null &&
    parents.has(cursor) &&
    !deletedIds.has(cursor) &&
    !seen.has(cursor) &&
    out.length < MAX_PROJECT_DEPTH - 1
  ) {
    out.push(cursor);
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return out;
}

/**
 * `PR-4`: whether a project-scope roster row can be removed on this project. A person who
 * holds no explicit row here but is a member of an ancestor has an inherited membership; it
 * is removed at the ancestor, never on the child. `PR-3`: an explicit row on the child
 * overrides the inherited role, and removing that explicit row is allowed (the inherited
 * membership then shows again).
 */
export type MemberRemovalDecision =
  | { removable: true }
  | { removable: false; code: "inherited_membership"; inheritedFrom: string };

export function decideMemberRemoval(input: {
  hasExplicitRow: boolean;
  ancestorIdsNearestFirst: readonly string[];
  ancestorMemberOf: ReadonlySet<string>;
}): MemberRemovalDecision {
  if (input.hasExplicitRow) return { removable: true };
  const from = input.ancestorIdsNearestFirst.find((id) =>
    input.ancestorMemberOf.has(id),
  );
  return from === undefined
    ? { removable: true }
    : { removable: false, code: "inherited_membership", inheritedFrom: from };
}
