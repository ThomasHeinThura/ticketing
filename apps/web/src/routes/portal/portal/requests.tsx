import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { PortalRequestsListScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/requests")({
  component: PortalRequestsRouteComponent,
});

function PortalRequestsRouteComponent() {
  const location = useLocation();
  if (
    location.pathname.startsWith("/portal/requests/") &&
    location.pathname !== "/portal/requests/"
  ) {
    return <Outlet />;
  }
  return <PortalRequestsListScreen />;
}
