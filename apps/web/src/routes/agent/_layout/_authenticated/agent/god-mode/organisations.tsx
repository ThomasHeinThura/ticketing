import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { GodModeOrganisationsListScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/organisations",
)({
  component: GodModeOrganisationsRouteComponent,
});

function GodModeOrganisationsRouteComponent() {
  const location = useLocation();
  if (
    location.pathname.startsWith("/agent/god-mode/organisations/") &&
    location.pathname !== "/agent/god-mode/organisations/"
  ) {
    return <Outlet />;
  }
  return <GodModeOrganisationsListScreen />;
}
