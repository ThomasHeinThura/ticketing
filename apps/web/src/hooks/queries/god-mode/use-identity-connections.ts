import { useQuery } from "@tanstack/react-query";
import {
  getIdentityConnectionEvents,
  getIdentityConnections,
  getScimAdminSettings,
  getScimMappingOptions,
  type ScimMappingOptions,
} from "@/fetchers/god-mode/identity-connections";
import { HttpError } from "@/lib/http-error";

export const identityConnectionsKey = [
  "god-mode",
  "identity-connections",
] as const;
export const scimAdminKey = (id: string) =>
  [...identityConnectionsKey, id, "scim"] as const;

/** Never retry an authorisation or contract failure; a retry cannot change its answer. */
const retryTransient = (count: number, error: unknown) =>
  !(error instanceof HttpError && error.status < 500) && count < 1;

/**
 * Configuration reads are deliberately not refetched in the background. Each write advances the
 * shared parent version, and a silent refetch could rebase a dirty draft onto another
 * administrator's change. Fresh data comes from an explicit reload or from this page's own writes.
 */
const configurationQuery = {
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnWindowFocus: false,
  retry: retryTransient,
} as const;

export function useIdentityConnections(enabled = true) {
  return useQuery({
    queryKey: identityConnectionsKey,
    queryFn: getIdentityConnections,
    enabled,
    ...configurationQuery,
  });
}

export function useIdentityConnectionEvents(
  id: string,
  cursor: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...identityConnectionsKey, id, "events", cursor ?? ""],
    queryFn: () => getIdentityConnectionEvents(id, cursor),
    enabled,
    retry: retryTransient,
  });
}

export function useScimAdminSettings(id: string, enabled: boolean) {
  return useQuery({
    queryKey: scimAdminKey(id),
    queryFn: () => getScimAdminSettings(id),
    enabled,
    ...configurationQuery,
  });
}

async function readAllTargets(
  id: string,
  workspaceId?: string,
): Promise<ScimMappingOptions> {
  let page = await getScimMappingOptions(id, workspaceId);
  if (page.kind === "customer") return page;
  const seen = new Set<string>();
  while (page.nextCursor && !seen.has(page.nextCursor)) {
    seen.add(page.nextCursor);
    const next = await getScimMappingOptions(id, workspaceId, page.nextCursor);
    if (next.kind !== page.kind) throw new Error("Unexpected selector result");
    page =
      page.kind === "agent_targets" && next.kind === "agent_targets"
        ? { ...next, data: [...page.data, ...next.data] }
        : page.kind === "agent_roles" && next.kind === "agent_roles"
          ? { ...next, data: [...page.data, ...next.data] }
          : page;
  }
  return page;
}

/** Eligible mapping targets (or, with a workspace, its eligible roles); read only while the form is open. */
export function useScimMappingOptions(
  id: string,
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...scimAdminKey(id), "options", workspaceId ?? ""],
    queryFn: () => readAllTargets(id, workspaceId),
    enabled,
    staleTime: 0,
    retry: retryTransient,
  });
}
