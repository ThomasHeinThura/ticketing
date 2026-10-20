import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { PortalRequestDetailScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/requests/$ref")({
  component: PortalRequestDetailRouteComponent,
});

function PortalRequestDetailRouteComponent() {
  const { ref } = Route.useParams();
  const location = useLocation();
  if (location.pathname.endsWith("/rate")) {
    return <Outlet />;
  }
  return <PortalRequestDetailScreen refParam={ref} />;
}
