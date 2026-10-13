import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { usePatchUserSettings } from "@/hooks/mutations/user-settings/use-patch-user-settings";
import {
  useGetUserSettings,
  userSettingsQueryKey,
} from "@/hooks/queries/user-settings/use-get-user-settings";
import {
  getPreferenceMarkerStorage,
  hasPreferenceMarker,
  isCacheOwnedByAnotherUser,
  reconcilePreference,
  setPreferenceCacheOwner,
  setPreferenceMarker,
} from "@/lib/user-preference-sync";
import { useUserPreferencesStore } from "@/store/user-preferences";

/** VW-6 density, persisted server-side as the `density` profile setting (ST-14). */
export const DENSITY_SETTING_KEY = "density";

export type Density = "comfortable" | "compact";

function parseDensity(value: unknown): Density | undefined {
  return value === "comfortable" || value === "compact" ? value : undefined;
}

function toDensity(compactMode: boolean): Density {
  return compactMode ? "compact" : "comfortable";
}

/**
 * Reconciles the browser's `compactMode` cache with the server's `density` setting.
 * Mount once, inside the auth provider (`UserPreferencesSync`).
 *
 * - The persisted store paints first; the server value replaces it once fetched.
 * - An existing non-default local value is uploaded once, then marked migrated.
 * - A local change that never reached the server is pushed instead of being overwritten.
 * - A local value known to belong to another user is never uploaded; it is reset to the default.
 * - If the read or write fails the cache keeps working and the next load retries.
 */
export function useDensityPreferenceSync() {
  const { user } = useAuth();
  const userId = user?.id;
  const { data } = useGetUserSettings(userId);
  const { mutateAsync: patchSettings } = usePatchUserSettings();
  const reconciledFor = useRef<unknown>(null);

  useEffect(() => {
    if (!userId || !data || reconciledFor.current === data) return;
    reconciledFor.current = data;

    const storage = getPreferenceMarkerStorage();
    const state = useUserPreferencesStore.getState();
    const foreignCache = isCacheOwnedByAnotherUser(
      storage,
      DENSITY_SETTING_KEY,
      userId,
    );
    if (foreignCache) state.setCompactMode(false);
    const compactMode = foreignCache ? false : state.compactMode;

    const serverDensity = parseDensity(data.settings[DENSITY_SETTING_KEY]);
    const localDensity = toDensity(compactMode);
    const action = reconcilePreference({
      serverValue: serverDensity,
      localValue: localDensity,
      localIsDefault: !compactMode,
      migrated: hasPreferenceMarker(
        storage,
        "migrated",
        userId,
        DENSITY_SETTING_KEY,
      ),
      dirty:
        !foreignCache &&
        hasPreferenceMarker(storage, "dirty", userId, DENSITY_SETTING_KEY),
    });

    if (action === "adopt-server" && serverDensity) {
      state.setCompactMode(serverDensity === "compact");
      setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
      setPreferenceMarker(
        storage,
        "migrated",
        userId,
        DENSITY_SETTING_KEY,
        true,
      );
    } else if (action === "push-local") {
      patchSettings({ [DENSITY_SETTING_KEY]: localDensity })
        .then(() => {
          setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
          setPreferenceMarker(
            storage,
            "migrated",
            userId,
            DENSITY_SETTING_KEY,
            true,
          );
          setPreferenceMarker(
            storage,
            "dirty",
            userId,
            DENSITY_SETTING_KEY,
            false,
          );
        })
        .catch(() => {
          // Offline or rejected: the cache stays authoritative locally, retried next load.
        });
    } else {
      // Nothing to upload or adopt: the cache now reflects this user's (default) choice.
      setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
    }
  }, [userId, data, patchSettings]);
}

/** The density control: updates the local cache at once, then syncs to the server. */
export function useDensityPreference() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const compactMode = useUserPreferencesStore((state) => state.compactMode);
  const setCompactMode = useUserPreferencesStore(
    (state) => state.setCompactMode,
  );
  const { mutateAsync: patchSettings } = usePatchUserSettings();

  const setDensity = useCallback(
    (density: Density) => {
      setCompactMode(density === "compact");
      if (!userId) return;
      const storage = getPreferenceMarkerStorage();
      setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
      setPreferenceMarker(storage, "dirty", userId, DENSITY_SETTING_KEY, true);
      patchSettings({ [DENSITY_SETTING_KEY]: density })
        .then(() => {
          setPreferenceMarker(
            storage,
            "dirty",
            userId,
            DENSITY_SETTING_KEY,
            false,
          );
          setPreferenceMarker(
            storage,
            "migrated",
            userId,
            DENSITY_SETTING_KEY,
            true,
          );
          void queryClient.invalidateQueries({
            queryKey: userSettingsQueryKey(userId),
          });
        })
        .catch(() => {
          // Kept dirty: pushed again on the next successful settings load.
        });
    },
    [userId, setCompactMode, patchSettings, queryClient],
  );

  return { density: toDensity(compactMode), setDensity };
}
