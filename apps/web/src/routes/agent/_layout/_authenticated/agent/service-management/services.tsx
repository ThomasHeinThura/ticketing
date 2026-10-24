import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ServicesList } from "@/components/service-management/services-list";
import { parseServiceListSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/service-management/services",
)({
  validateSearch: parseServiceListSearch,
  component: ServicesRoute,
});

function ServicesRoute() {
  const { pathname } = useLocation();
  const { q } = Route.useSearch();
  if (pathname.startsWith(`${routes.serviceManagementServices.path}/`))
    return <Outlet />;
  return <ServicesList q={q} />;
}
