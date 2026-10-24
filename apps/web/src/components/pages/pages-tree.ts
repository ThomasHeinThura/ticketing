import type { PageSummary } from "@/fetchers/pages";

export type PageTreeRow = { page: PageSummary; depth: number };

/**
 * The pages of a project as a depth-first list (siblings by title). A page whose parent is not in
 * the list (for example a parent deleted elsewhere) is shown at the top level, never hidden.
 */
export function flattenPageTree(pages: readonly PageSummary[]): PageTreeRow[] {
  const ids = new Set(pages.map((page) => page.id));
  const children = new Map<string | null, PageSummary[]>();
  for (const page of pages) {
    const key = page.parentId && ids.has(page.parentId) ? page.parentId : null;
    const list = children.get(key) ?? [];
    list.push(page);
    children.set(key, list);
  }
  const rows: PageTreeRow[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    const siblings = [...(children.get(parent) ?? [])].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    for (const page of siblings) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      rows.push({ page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/** A page and everything under it: none of these may become the page's own parent. */
export function descendantIds(
  pages: readonly PageSummary[],
  rootId: string,
): Set<string> {
  const result = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of pages)
      if (page.parentId && result.has(page.parentId) && !result.has(page.id)) {
        result.add(page.id);
        grew = true;
      }
  }
  return result;
}
