import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { GodModeOrganisationDetailScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/organisations/$id",
)({
  component: GodModeOrganisationDetailRouteComponent,
});

function GodModeOrganisationDetailRouteComponent() {
  const { id } = Route.useParams();
  const location = useLocation();
  if (location.pathname.endsWith("/identity")) {
    return <Outlet />;
  }
  return <GodModeOrganisationDetailScreen id={id} />;
}
