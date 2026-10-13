import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { getUserSettings } from "@/fetchers/user-settings/user-settings";
import { usePatchUserSettings } from "@/hooks/mutations/user-settings/use-patch-user-settings";
import {
  useGetUserSettings,
  userSettingsQueryKey,
} from "@/hooks/queries/user-settings/use-get-user-settings";
import {
  getPreferenceMarkerStorage,
  hasPreferenceMarker,
  isCacheOwnedByAnotherUser,
  isTerminalWriteRejection,
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

// Writes are sent one at a time, in order, so an older toggle can never land after a newer one
// on the server. Only the most recent write may clear the "unsent" mark or adopt server state,
// so an earlier success cannot hide a later change that is still in flight or failed.
//
// The queue and generation are kept PER USER, and every send and every adopt re-checks that the
// signed-in user is still the one who made the change. Sign-out does not reload the page, so a
// write queued for user A must never be sent (with B's session) or applied after B signs in.
const writeStates = new Map<
  string,
  { chain: Promise<unknown>; latest: number }
>();
let activeUserId: string | undefined;

function writeStateFor(userId: string) {
  let state = writeStates.get(userId);
  if (!state) {
    state = { chain: Promise.resolve(), latest: 0 };
    writeStates.set(userId, state);
  }
  return state;
}

/** Records who is signed in so queued writes for anyone else are dropped, not sent. */
function useActiveUser(userId: string | undefined) {
  useLayoutEffect(() => {
    activeUserId = userId;
  }, [userId]);
}

class SupersededByUserChange extends Error {}

type DensityWriter = (patch: Record<string, unknown>) => Promise<unknown>;

function writeDensity(input: {
  userId: string;
  density: Density;
  patchSettings: DensityWriter;
  queryClient: QueryClient;
}) {
  const { userId, density, patchSettings, queryClient } = input;
  const state = writeStateFor(userId);
  const generation = ++state.latest;
  const storage = getPreferenceMarkerStorage();
  // Send-time check: the session cookie belongs to whoever is signed in NOW. A change made
  // by another user is dropped (it stays unsent under that user's marker) instead of being
  // written to this user's account.
  const send = () =>
    activeUserId === userId
      ? patchSettings({ [DENSITY_SETTING_KEY]: density })
      : Promise.reject(new SupersededByUserChange());
  const result = state.chain.then(send, send);
  state.chain = result.catch(() => undefined);

  result.then(
    () => {
      if (generation !== state.latest || activeUserId !== userId) return;
      setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
      setPreferenceMarker(
        storage,
        "migrated",
        userId,
        DENSITY_SETTING_KEY,
        true,
      );
      setPreferenceMarker(storage, "dirty", userId, DENSITY_SETTING_KEY, false);
      void queryClient.invalidateQueries({
        queryKey: userSettingsQueryKey(userId),
      });
    },
    async (error: unknown) => {
      // Offline or transient: stay dirty and retry on the next successful load.
      if (
        error instanceof SupersededByUserChange ||
        generation !== state.latest ||
        activeUserId !== userId ||
        !isTerminalWriteRejection(error)
      )
        return;
      // The server permanently refuses this value: drop it and adopt the server state.
      setPreferenceMarker(storage, "dirty", userId, DENSITY_SETTING_KEY, false);
      try {
        const fresh = await queryClient.fetchQuery({
          queryKey: userSettingsQueryKey(userId),
          queryFn: getUserSettings,
          staleTime: 0,
        });
        // Adopt-time check: the user may have changed while the refetch was in flight.
        if (activeUserId !== userId) return;
        useUserPreferencesStore
          .getState()
          .setCompactMode(
            parseDensity(fresh.settings[DENSITY_SETTING_KEY]) === "compact",
          );
        setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
        setPreferenceMarker(
          storage,
          "migrated",
          userId,
          DENSITY_SETTING_KEY,
          true,
        );
      } catch {
        // Server unreachable: the next load adopts its state; nothing is retried.
      }
    },
  );
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
  const queryClient = useQueryClient();
  const reconciledFor = useRef<unknown>(null);
  useActiveUser(userId);

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
      writeDensity({
        userId,
        density: localDensity,
        patchSettings,
        queryClient,
      });
    } else {
      // Nothing to upload or adopt: the cache now reflects this user's (default) choice.
      setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
    }
  }, [userId, data, patchSettings, queryClient]);
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
  useActiveUser(userId);

  const setDensity = useCallback(
    (density: Density) => {
      setCompactMode(density === "compact");
      if (!userId) return;
      const storage = getPreferenceMarkerStorage();
      setPreferenceCacheOwner(storage, DENSITY_SETTING_KEY, userId);
      setPreferenceMarker(storage, "dirty", userId, DENSITY_SETTING_KEY, true);
      writeDensity({ userId, density, patchSettings, queryClient });
    },
    [userId, setCompactMode, patchSettings, queryClient],
  );

  return { density: toDensity(compactMode), setDensity };
}
