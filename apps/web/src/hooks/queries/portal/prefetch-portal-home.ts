import type { QueryClient } from "@tanstack/react-query";
import type { PortalHomeSearch } from "@/lib/routes";
import { outstandingCasesQuery } from "./outstanding-cases-query";
import { portalProjectsOptions } from "./portal-projects-options";
import { portalCasesOptions, portalHomeOptions } from "./use-portal-cases";

export function prefetchPortalHome(
  client: QueryClient,
  portalUserId: string,
  search: PortalHomeSearch,
) {
  void client.prefetchQuery(portalHomeOptions(portalUserId, search.project));
  void client.prefetchQuery(portalProjectsOptions());
  void client.prefetchQuery(
    portalCasesOptions(
      portalUserId,
      outstandingCasesQuery(search, search.project),
    ),
  );
}
