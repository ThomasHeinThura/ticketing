/**
 * Local-cache bookkeeping for server-synced preferences (settings-hierarchy.md ST-17).
 *
 * A preference's browser copy is only a first-paint cache. Two per-user markers decide how it
 * reconciles with the server value:
 *  - `migrated`: the browser's pre-existing value has been written to (or replaced by) the server
 *    once, so it is never uploaded again.
 *  - `dirty`: the user changed the value but the write has not reached the server yet (offline or
 *    rejected). A dirty local value is pushed up instead of being overwritten by the older
 *    server value.
 */

export interface PreferenceMarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PreferenceMarker = "migrated" | "dirty";

export function getPreferenceMarkerStorage():
  | PreferenceMarkerStorage
  | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function markerKey(
  marker: PreferenceMarker,
  userId: string,
  preferenceKey: string,
  scopeId?: string,
) {
  return `taskdesk:preference-${marker}:${userId}:${preferenceKey}${
    scopeId ? `:${scopeId}` : ""
  }`;
}

export function hasPreferenceMarker(
  storage: PreferenceMarkerStorage | undefined,
  marker: PreferenceMarker,
  userId: string,
  preferenceKey: string,
  scopeId?: string,
): boolean {
  if (!storage) return false;
  try {
    return (
      storage.getItem(markerKey(marker, userId, preferenceKey, scopeId)) === "1"
    );
  } catch {
    return false;
  }
}

export function setPreferenceMarker(
  storage: PreferenceMarkerStorage | undefined,
  marker: PreferenceMarker,
  userId: string,
  preferenceKey: string,
  on: boolean,
  scopeId?: string,
) {
  if (!storage) return;
  try {
    const key = markerKey(marker, userId, preferenceKey, scopeId);
    if (on) storage.setItem(key, "1");
    else storage.removeItem(key);
  } catch {
    // Storage may be unavailable (private browsing); the server value still wins next load.
  }
}

export type PreferenceReconcileAction = "adopt-server" | "push-local" | "none";

/**
 * Decide how to reconcile one preference after the server read succeeded.
 *
 * - A dirty local value is the user's newest choice: push it.
 * - Otherwise a server value wins and replaces the cache.
 * - With no server value, an existing non-default local value is uploaded once (migration).
 *   A default local value is not uploaded: it is indistinguishable from "never chosen" and
 *   would otherwise overwrite a choice made on another device before it migrated.
 */
export function reconcilePreference(input: {
  serverValue: unknown;
  localValue: unknown;
  localIsDefault: boolean;
  migrated: boolean;
  dirty: boolean;
}): PreferenceReconcileAction {
  if (input.dirty && input.localValue !== undefined) return "push-local";
  if (input.serverValue !== undefined) return "adopt-server";
  if (
    !input.migrated &&
    input.localValue !== undefined &&
    !input.localIsDefault
  )
    return "push-local";
  return "none";
}

/**
 * Who the browser copy belongs to. The persisted store is per browser, not per user, so a value
 * written by one person must never be uploaded as another person's. A copy with no recorded
 * owner predates this attribution and is claimed by the first user who signs in.
 */
function cacheOwnerKey(preferenceKey: string) {
  return `taskdesk:preference-cache-owner:${preferenceKey}`;
}

export function getPreferenceCacheOwner(
  storage: PreferenceMarkerStorage | undefined,
  preferenceKey: string,
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(cacheOwnerKey(preferenceKey));
  } catch {
    return null;
  }
}

export function setPreferenceCacheOwner(
  storage: PreferenceMarkerStorage | undefined,
  preferenceKey: string,
  userId: string,
) {
  if (!storage) return;
  try {
    storage.setItem(cacheOwnerKey(preferenceKey), userId);
  } catch {
    // Unavailable storage: no cache survives anyway.
  }
}

/** True when the browser copy is known to belong to a different user than `userId`. */
export function isCacheOwnedByAnotherUser(
  storage: PreferenceMarkerStorage | undefined,
  preferenceKey: string,
  userId: string,
): boolean {
  const owner = getPreferenceCacheOwner(storage, preferenceKey);
  return owner !== null && owner !== userId;
}
