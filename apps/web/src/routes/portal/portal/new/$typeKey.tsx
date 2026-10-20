import { createFileRoute } from "@tanstack/react-router";
import { PortalNewRequestFormScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/new/$typeKey")({
  component: PortalNewRequestFormRouteComponent,
});

function PortalNewRequestFormRouteComponent() {
  const { typeKey } = Route.useParams();
  return <PortalNewRequestFormScreen typeKey={typeKey} />;
}
