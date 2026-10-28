import { routes } from "@/lib/routes";

/**
 * The palette-visible result kinds. `task`, `comment` and `activity` are the legacy Kaneo task
 * model's rows: the canonical work item result replaces them, so they are never shown.
 */
export type PaletteResultType =
  | "work_item"
  | "person"
  | "saved_view"
  | "kb_article"
  | "page"
  | "project"
  | "workspace";

export type SearchResultItem = {
  id: string;
  title: string;
  description?: string;
  content?: string;
  type: PaletteResultType | "task" | "comment" | "activity";
  key?: string;
  projectId?: string;
  workspaceId?: string;
  taskNumber?: number;
  projectSlug?: string;
  priority?: string;
  status?: string;
};

export type PaletteEntry = {
  id: string;
  type: PaletteResultType;
  title: string;
  description?: string;
  href: string;
};

export type SearchGroup = {
  value: string;
  label: string;
  items: PaletteEntry[];
};

export const PALETTE_RESULT_TYPES: readonly PaletteResultType[] = [
  "work_item",
  "saved_view",
  "kb_article",
  "page",
  "project",
  "person",
  "workspace",
];

export function isPaletteResult(
  item: SearchResultItem,
): item is SearchResultItem & { type: PaletteResultType } {
  return (PALETTE_RESULT_TYPES as readonly string[]).includes(item.type);
}

/** The canonical `/agent` destination of a result, or null when it has none. */
export function searchResultHref(item: SearchResultItem): string | null {
  switch (item.type) {
    case "work_item":
      return item.key ? routes.workItemDetail.build({ key: item.key }) : null;
    case "project":
      return item.projectSlug
        ? routes.projectOverview.build({ projectKey: item.projectSlug })
        : null;
    case "page":
      return item.id && item.projectSlug
        ? routes.projectPage.build({
            projectKey: item.projectSlug,
            pageId: item.id,
          })
        : null;
    case "saved_view":
      return item.id ? routes.savedView.build({ id: item.id }) : null;
    case "kb_article":
      return item.id ? routes.kbArticle.build({ id: item.id }) : null;
    case "person":
      return routes.workspaceMembers.build({ q: item.title });
    case "workspace":
      return item.id
        ? `/dashboard/workspace/${encodeURIComponent(item.id)}`
        : null;
    default:
      return null;
  }
}

/** Shared result projection for the Kaneo search dialog and the Cmd+K palette. */
export function projectSearchGroups(
  query: string,
  results: readonly SearchResultItem[],
  recentItems: readonly PaletteEntry[],
  translate: (key: string) => string,
): SearchGroup[] {
  if (!query.trim()) {
    return recentItems.length > 0
      ? [
          {
            value: "recent",
            label: translate("navigation:search.groups.recent"),
            items: [...recentItems],
          },
        ]
      : [];
  }

  const grouped = new Map<PaletteResultType, PaletteEntry[]>();
  for (const item of results) {
    if (!isPaletteResult(item)) continue;
    const href = searchResultHref(item);
    if (!href) continue;
    const entry: PaletteEntry = {
      id: item.id,
      type: item.type,
      title:
        item.type === "work_item" && item.key
          ? `${item.key} ${item.title}`
          : item.title,
      description: item.description,
      href,
    };
    const bucket = grouped.get(item.type) ?? [];
    bucket.push(entry);
    grouped.set(item.type, bucket);
  }

  const groupLabel = (type: PaletteResultType) => {
    switch (type) {
      case "work_item":
        return translate("navigation:search.groups.workItem");
      case "saved_view":
        return translate("navigation:search.groups.savedView");
      case "page":
        return translate("navigation:search.groups.page");
      case "kb_article":
        return translate("navigation:sidebar.knowledgeBase");
      case "project":
        return translate("navigation:search.groups.project");
      case "person":
        return translate("navigation:search.groups.person");
      case "workspace":
        return translate("navigation:search.groups.workspace");
    }
  };

  // The API's order is the relevance authority. Map insertion order keeps the
  // group containing the best result first, with each group retaining its rank.
  return [...grouped.entries()].map(([type, items]) => ({
    value: type,
    label: groupLabel(type),
    items,
  }));
}
