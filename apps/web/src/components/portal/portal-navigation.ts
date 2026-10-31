import { routes } from "@/lib/routes";

/** A portal navigation entry: its link target and the path prefixes that mark it active. */
export type PortalNavigationMatch = {
  to: string;
  /** Exact match only (the dashboard at `/`). */
  exact?: boolean;
  /** Extra path prefixes that belong to this entry, beyond `to` itself. */
  prefixes?: readonly string[];
};

function underPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * True when `pathname` belongs to the entry. The dashboard matches `/` only; every other entry
 * matches its own path and its listed prefixes, so `/submissions/SUB-7` keeps Support active.
 */
export function isPortalNavigationActive(
  pathname: string,
  entry: PortalNavigationMatch,
) {
  if (entry.exact) return pathname === entry.to;
  return [entry.to, ...(entry.prefixes ?? [])].some((prefix) =>
    underPrefix(pathname, prefix),
  );
}

/** `aria-current="page"` belongs to the exact page only, never to a section parent. */
export function portalAriaCurrent(pathname: string, to: string) {
  return pathname === to ? ("page" as const) : undefined;
}

/** Support owns the request list, request detail, catalogue, approvals and knowledge base. */
export const portalSupportMatch: PortalNavigationMatch = {
  to: routes.portalRequests.path,
  prefixes: [
    "/submissions",
    routes.portalCatalogue.path,
    routes.portalApprovals.path,
    routes.portalKb.path,
  ],
};
