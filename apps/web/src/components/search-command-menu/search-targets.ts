import { routes } from "@/lib/routes";

/**
 * The palette-visible result kinds. `task`, `comment` and `activity` are the legacy Kaneo task
 * model's rows: the canonical work item result replaces them, so they are never shown.
 */
export type PaletteResultType =
  | "work_item"
  | "person"
  | "saved_view"
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

export const PALETTE_RESULT_TYPES: readonly PaletteResultType[] = [
  "work_item",
  "saved_view",
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
