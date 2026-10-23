import type { PaletteResultType } from "./search-targets";

/**
 * SV-6: items the user opened from the palette, shown before any query is typed. This is a
 * per-viewer convenience kept in the browser (per workspace, newest first, bounded); it is
 * never an authority: opening one is an ordinary navigation that the API re-authorises.
 */
export type RecentItem = {
  type: PaletteResultType;
  id: string;
  title: string;
  description?: string;
  href: string;
};

export const MAX_RECENT_ITEMS = 8;

function storageKey(workspaceId: string) {
  return `taskdesk:palette-recent:${workspaceId}`;
}

function isRecentItem(value: unknown): value is RecentItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.type === "string" &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.href === "string" &&
    item.href.startsWith("/")
  );
}

export function readRecentItems(workspaceId: string): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isRecentItem).slice(0, MAX_RECENT_ITEMS)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentItem(workspaceId: string, item: RecentItem) {
  try {
    const next = [
      item,
      ...readRecentItems(workspaceId).filter(
        (existing) => !(existing.type === item.type && existing.id === item.id),
      ),
    ].slice(0, MAX_RECENT_ITEMS);
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private window, blocked site data); recents are optional.
  }
}
