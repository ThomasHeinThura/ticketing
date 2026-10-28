import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WebhookList } from "@/components/webhook/webhook-list";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/webhooks",
)({
  component: WebhooksRoute,
});

function WebhooksRoute() {
  const location = useLocation();
  if (location.pathname.startsWith(`${routes.webhooks.path}/`))
    return <Outlet />;
  return <WebhookList />;
}
