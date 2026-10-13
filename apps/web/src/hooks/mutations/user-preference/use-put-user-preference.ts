import { useMutation } from "@tanstack/react-query";
import {
  putUserPreference,
  type UserPreferenceScope,
} from "@/fetchers/user-preference/user-preferences";

/**
 * Writes one of the caller's preferences. Deliberately silent on failure: the local cache is
 * already updated and the caller keeps a `dirty` marker so the value is pushed again on the
 * next successful load (views.md PREF-8).
 */
export function usePutUserPreference() {
  return useMutation({
    mutationFn: (input: {
      scope: UserPreferenceScope;
      key: string;
      scopeId?: string;
      value: unknown;
    }) => putUserPreference(input),
  });
}
