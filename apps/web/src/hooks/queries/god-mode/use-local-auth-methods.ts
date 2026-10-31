import { useQuery } from "@tanstack/react-query";
import { getLocalAuthMethods } from "@/fetchers/god-mode/local-auth-methods";
import { HttpError } from "@/lib/http-error";

export const localAuthMethodsKey = [
  "god-mode",
  "auth",
  "local-methods",
] as const;

/**
 * Not refetched in the background: a silent refetch would overwrite an administrator's unsaved
 * switches. Fresh data comes from this card's own save or an explicit retry.
 */
export function useLocalAuthMethods(enabled = true) {
  return useQuery({
    queryKey: localAuthMethodsKey,
    queryFn: getLocalAuthMethods,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: (count, error) =>
      !(error instanceof HttpError && error.status < 500) && count < 1,
  });
}
