import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { PortalProjectsListScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/projects")({
  component: PortalProjectsRouteComponent,
});

function PortalProjectsRouteComponent() {
  const location = useLocation();
  if (
    location.pathname.startsWith("/portal/projects/") &&
    location.pathname !== "/portal/projects/"
  ) {
    return <Outlet />;
  }
  return <PortalProjectsListScreen />;
}
