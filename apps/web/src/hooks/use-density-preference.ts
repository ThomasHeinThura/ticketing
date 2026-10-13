import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { usePutUserPreference } from "@/hooks/mutations/user-preference/use-put-user-preference";
import {
  useGetUserPreferences,
  userPreferencesQueryKey,
} from "@/hooks/queries/user-preference/use-get-user-preferences";
import {
  getPreferenceMarkerStorage,
  hasPreferenceMarker,
  reconcilePreference,
  setPreferenceMarker,
} from "@/lib/user-preference-sync";
import { useUserPreferencesStore } from "@/store/user-preferences";

/** VW-6 density, persisted server-side as the global `appearance.density` preference. */
export const DENSITY_PREFERENCE_KEY = "appearance.density";

export type Density = "comfortable" | "compact";

function parseDensity(value: unknown): Density | undefined {
  return value === "comfortable" || value === "compact" ? value : undefined;
}

function toDensity(compactMode: boolean): Density {
  return compactMode ? "compact" : "comfortable";
}

/**
 * Reconciles the browser's `compactMode` cache with the server's `appearance.density`.
 * Mount once, inside the auth provider (`UserPreferencesSync`).
 *
 * - The persisted store paints first; the server value replaces it once fetched.
 * - An existing non-default local value is uploaded once, then marked migrated.
 * - A local change that never reached the server is pushed instead of being overwritten.
 * - If the read or write fails the cache keeps working and the next load retries.
 */
export function useDensityPreferenceSync() {
  const { user } = useAuth();
  const userId = user?.id;
  const { data } = useGetUserPreferences({ userId, scope: "global" });
  const { mutateAsync: putPreference } = usePutUserPreference();
  const reconciledFor = useRef<unknown>(null);

  useEffect(() => {
    if (!userId || !data || reconciledFor.current === data) return;
    reconciledFor.current = data;

    const storage = getPreferenceMarkerStorage();
    const state = useUserPreferencesStore.getState();
    const serverDensity = parseDensity(
      data.preferences.find((item) => item.key === DENSITY_PREFERENCE_KEY)
        ?.value,
    );
    const localDensity = toDensity(state.compactMode);
    const action = reconcilePreference({
      serverValue: serverDensity,
      localValue: localDensity,
      localIsDefault: !state.compactMode,
      migrated: hasPreferenceMarker(
        storage,
        "migrated",
        userId,
        DENSITY_PREFERENCE_KEY,
      ),
      dirty: hasPreferenceMarker(
        storage,
        "dirty",
        userId,
        DENSITY_PREFERENCE_KEY,
      ),
    });

    if (action === "adopt-server" && serverDensity) {
      state.setCompactMode(serverDensity === "compact");
      setPreferenceMarker(
        storage,
        "migrated",
        userId,
        DENSITY_PREFERENCE_KEY,
        true,
      );
    } else if (action === "push-local") {
      putPreference({
        scope: "global",
        key: DENSITY_PREFERENCE_KEY,
        value: localDensity,
      })
        .then(() => {
          setPreferenceMarker(
            storage,
            "migrated",
            userId,
            DENSITY_PREFERENCE_KEY,
            true,
          );
          setPreferenceMarker(
            storage,
            "dirty",
            userId,
            DENSITY_PREFERENCE_KEY,
            false,
          );
        })
        .catch(() => {
          // Offline or rejected: the cache stays authoritative locally, retried next load.
        });
    }
  }, [userId, data, putPreference]);
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
  const { mutateAsync: putPreference } = usePutUserPreference();

  const setDensity = useCallback(
    (density: Density) => {
      setCompactMode(density === "compact");
      if (!userId) return;
      const storage = getPreferenceMarkerStorage();
      setPreferenceMarker(
        storage,
        "dirty",
        userId,
        DENSITY_PREFERENCE_KEY,
        true,
      );
      putPreference({
        scope: "global",
        key: DENSITY_PREFERENCE_KEY,
        value: density,
      })
        .then(() => {
          setPreferenceMarker(
            storage,
            "dirty",
            userId,
            DENSITY_PREFERENCE_KEY,
            false,
          );
          setPreferenceMarker(
            storage,
            "migrated",
            userId,
            DENSITY_PREFERENCE_KEY,
            true,
          );
          void queryClient.invalidateQueries({
            queryKey: userPreferencesQueryKey(userId, "global"),
          });
        })
        .catch(() => {
          // Kept dirty: pushed again on the next successful preference load.
        });
    },
    [userId, setCompactMode, putPreference, queryClient],
  );

  return { density: toDensity(compactMode), setDensity };
}
