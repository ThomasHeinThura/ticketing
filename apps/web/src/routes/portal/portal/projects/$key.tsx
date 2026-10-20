import { createFileRoute } from "@tanstack/react-router";
import { PortalProjectDetailScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/projects/$key")({
  component: PortalProjectDetailRouteComponent,
});

function PortalProjectDetailRouteComponent() {
  const { key } = Route.useParams();
  return <PortalProjectDetailScreen projectKey={key} />;
}
