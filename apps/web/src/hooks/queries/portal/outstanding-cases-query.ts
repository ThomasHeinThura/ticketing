import {
  PORTAL_OUTSTANDING_STATUSES,
  type PortalHomeSearch,
} from "@/lib/routes";

export function outstandingCasesQuery(
  filters: Pick<PortalHomeSearch, "scope" | "status" | "priority">,
  project?: string,
) {
  const { scope, priority } = filters;
  return {
    scope: scope ?? "mine",
    status: filters.status ?? PORTAL_OUTSTANDING_STATUSES.join(","),
    ...(priority ? { priority } : {}),
    ...(project ? { project } : {}),
    limit: 10,
  } as const;
}
