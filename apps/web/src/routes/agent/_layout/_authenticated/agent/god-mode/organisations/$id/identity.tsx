import { createFileRoute } from "@tanstack/react-router";
import { GodModeOrganisationIdentityScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/organisations/$id/identity",
)({
  component: GodModeOrganisationIdentityRouteComponent,
});

function GodModeOrganisationIdentityRouteComponent() {
  const { id } = Route.useParams();
  return <GodModeOrganisationIdentityScreen id={id} />;
}
