import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ReleasesList } from "@/components/service-management/releases-list";
import { parseReleaseListSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/service-management/releases",
)({
  validateSearch: parseReleaseListSearch,
  component: ReleasesRoute,
});

function ReleasesRoute() {
  const { pathname } = useLocation();
  const search = Route.useSearch();
  if (pathname.startsWith(`${routes.serviceManagementReleases.path}/`))
    return <Outlet />;
  return <ReleasesList search={search} />;
}
