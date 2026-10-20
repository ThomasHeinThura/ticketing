import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { PortalNewCatalogueScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/new")({
  component: PortalNewCatalogueRouteComponent,
});

function PortalNewCatalogueRouteComponent() {
  const location = useLocation();
  if (
    location.pathname.startsWith("/portal/new/") &&
    location.pathname !== "/portal/new/"
  ) {
    return <Outlet />;
  }
  return <PortalNewCatalogueScreen />;
}
