import { useQuery } from "@tanstack/react-query";
import {
  getUserPreferences,
  type UserPreferenceScope,
} from "@/fetchers/user-preference/user-preferences";

export function userPreferencesQueryKey(
  userId: string | undefined,
  scope: UserPreferenceScope,
  scopeId?: string,
) {
  return ["user-preferences", userId, scope, scopeId ?? null] as const;
}

/**
 * The caller's own stored preferences for one scope. Disabled until a signed-in user id is
 * known so the cache key is always per user. Failures are not retried: the local cache keeps
 * serving, and the next mount tries again.
 */
export function useGetUserPreferences(input: {
  userId: string | undefined;
  scope: UserPreferenceScope;
  scopeId?: string;
}) {
  return useQuery({
    queryKey: userPreferencesQueryKey(input.userId, input.scope, input.scopeId),
    queryFn: () =>
      getUserPreferences({
        scope: input.scope,
        ...(input.scopeId ? { scopeId: input.scopeId } : {}),
      }),
    enabled: Boolean(input.userId),
    retry: false,
    staleTime: 60_000,
  });
}
