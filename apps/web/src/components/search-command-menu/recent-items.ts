import type { PaletteResultType } from "./search-targets";

/**
 * SV-6: items the user opened from the palette, shown before any query is typed. This is a
 * per-viewer convenience kept in the browser (per user and workspace, newest first, bounded; cleared on sign-out); it is
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

const KEY_PREFIX = "taskdesk:palette-recent:";

function storageKey(userId: string, workspaceId: string) {
  return `${KEY_PREFIX}${userId}:${workspaceId}`;
}

/** Remove every stored recent list (all users and workspaces, plus the legacy un-scoped keys). */
export function clearRecentItems() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable; nothing to clear.
  }
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

export function readRecentItems(
  userId: string,
  workspaceId: string,
): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isRecentItem).slice(0, MAX_RECENT_ITEMS)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentItem(
  userId: string,
  workspaceId: string,
  item: RecentItem,
) {
  try {
    const next = [
      item,
      ...readRecentItems(userId, workspaceId).filter(
        (existing) => !(existing.type === item.type && existing.id === item.id),
      ),
    ].slice(0, MAX_RECENT_ITEMS);
    window.localStorage.setItem(
      storageKey(userId, workspaceId),
      JSON.stringify(next),
    );
  } catch {
    // Storage can be unavailable (private window, blocked site data); recents are optional.
  }
}
