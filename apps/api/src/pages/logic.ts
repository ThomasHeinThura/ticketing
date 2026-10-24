/**
 * Pure rules for project pages (feature-contracts-p5.md, "Project pages"). No database, no clock.
 */

export const MAX_PAGE_TITLE_LENGTH = 200;
/** The deepest a page may sit in the tree (a top-level page has depth 1). */
export const MAX_PAGE_TREE_DEPTH = 8;
/** Soft-deleted pages are retained this long (PG-7 restore window) before they become purgeable. */
export const PAGE_RESTORE_WINDOW_DAYS = 30;
export const PAGE_SNIPPET_LENGTH = 160;

export type TreeNode = { id: string; parentId: string | null };

export type ParentRefusal = "parent_is_self" | "parent_cycle" | "too_deep";

/**
 * Whether moving `pageId` under `newParentId` is allowed, given every live page of the project.
 * Refuses a self-parent, a cycle (the new parent is a descendant of the page) and a tree deeper
 * than `MAX_PAGE_TREE_DEPTH` counting the page's own subtree. A null parent is always allowed.
 */
export function checkParent(
  pages: readonly TreeNode[],
  pageId: string | null,
  newParentId: string | null,
): ParentRefusal | null {
  if (newParentId === null) return null;
  if (pageId !== null && newParentId === pageId) return "parent_is_self";
  const byId = new Map(pages.map((page) => [page.id, page]));
  let depthAbove = 0;
  const seen = new Set<string>();
  let cursor: string | null = newParentId;
  while (cursor !== null) {
    if (pageId !== null && cursor === pageId) return "parent_cycle";
    // A pre-existing loop in stored data must never hang the request.
    if (seen.has(cursor)) return "parent_cycle";
    seen.add(cursor);
    depthAbove += 1;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  const subtree = pageId === null ? 1 : subtreeHeight(pages, pageId);
  return depthAbove + subtree > MAX_PAGE_TREE_DEPTH ? "too_deep" : null;
}

/** Levels in the subtree rooted at `rootId`, counting the root itself (a leaf is 1). */
export function subtreeHeight(
  pages: readonly TreeNode[],
  rootId: string,
): number {
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parentId === null) continue;
    const list = children.get(page.parentId) ?? [];
    list.push(page.id);
    children.set(page.parentId, list);
  }
  let height = 0;
  let level = [rootId];
  const seen = new Set<string>(level);
  while (level.length > 0) {
    height += 1;
    const next: string[] = [];
    for (const id of level)
      for (const child of children.get(id) ?? [])
        if (!seen.has(child)) {
          seen.add(child);
          next.push(child);
        }
    level = next;
  }
  return height;
}

/** PG-5: a save is stale when the page has moved on from the version the client edited. */
export function isStale(currentVersion: number, expectedVersion: number) {
  return currentVersion !== expectedVersion;
}

export function snippetOf(bodyText: string): string {
  const flat = bodyText.replace(/\s+/g, " ").trim();
  return flat.length > PAGE_SNIPPET_LENGTH
    ? `${flat.slice(0, PAGE_SNIPPET_LENGTH - 1)}…`
    : flat;
}

/** The purge deadline for a page deleted at `now`. */
export function purgeDeadline(now: Date): Date {
  return new Date(now.getTime() + PAGE_RESTORE_WINDOW_DAYS * 86_400_000);
}
