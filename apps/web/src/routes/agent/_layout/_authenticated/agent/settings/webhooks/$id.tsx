import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WebhookEditor } from "@/components/webhook/webhook-editor";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/webhooks/$id",
)({
  component: WebhookEditorRoute,
});

function WebhookEditorRoute() {
  const { id } = Route.useParams();
  const location = useLocation();
  if (location.pathname.endsWith("/deliveries")) return <Outlet />;
  return <WebhookEditor id={id} />;
}
