import { useQuery } from "@tanstack/react-query";
import { getUserSettings } from "@/fetchers/user-settings/user-settings";

export function userSettingsQueryKey(userId: string | undefined) {
  return ["user-settings", userId] as const;
}

/**
 * The caller's own stored settings. Disabled until a signed-in user id is known so the cache
 * key is always per user. Failures are not retried: the local cache keeps serving, and the
 * next mount tries again.
 */
export function useGetUserSettings(userId: string | undefined) {
  return useQuery({
    queryKey: userSettingsQueryKey(userId),
    queryFn: getUserSettings,
    enabled: Boolean(userId),
    retry: false,
    staleTime: 60_000,
  });
}
