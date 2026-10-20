import { createFileRoute } from "@tanstack/react-router";
import { PortalSatisfactionSurveyScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute("/portal/requests/$ref/rate")({
  component: PortalSatisfactionSurveyRouteComponent,
});

function PortalSatisfactionSurveyRouteComponent() {
  const { ref } = Route.useParams();
  return <PortalSatisfactionSurveyScreen refParam={ref} />;
}
