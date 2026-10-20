import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { PortalDashboardHomeScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal")({
  component: PortalHomeRouteComponent,
});

function PortalHomeRouteComponent() {
  const location = useLocation();
  if (location.pathname !== "/portal" && location.pathname !== "/portal/") {
    return <Outlet />;
  }
  return <PortalDashboardHomeScreen />;
}
