import { createFileRoute } from "@tanstack/react-router";
import { DeliveryHistory } from "@/components/webhook/delivery-history";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/webhooks/$id/deliveries",
)({
  component: WebhookDeliveriesRoute,
});

function WebhookDeliveriesRoute() {
  const { id } = Route.useParams();
  return <DeliveryHistory webhookId={id} />;
}
