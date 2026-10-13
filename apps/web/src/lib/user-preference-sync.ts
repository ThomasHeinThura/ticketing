/**
 * Local-cache bookkeeping for server-synced preferences (views.md PREF-8).
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
