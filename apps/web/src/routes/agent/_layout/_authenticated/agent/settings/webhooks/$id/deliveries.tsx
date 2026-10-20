import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceWebhookDeliveriesScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/webhooks/$id/deliveries",
)({
  component: WorkspaceWebhookDeliveriesRouteComponent,
});

function WorkspaceWebhookDeliveriesRouteComponent() {
  const { id } = Route.useParams() as { id: string };
  return <WorkspaceWebhookDeliveriesScreen id={id} />;
}
