import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WorkspaceWebhooksListScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/webhooks",
)({
  component: WorkspaceWebhooksRouteComponent,
});

function WorkspaceWebhooksRouteComponent() {
  const location = useLocation();
  if (location.pathname.startsWith("/agent/settings/webhooks/")) {
    return <Outlet />;
  }
  return <WorkspaceWebhooksListScreen />;
}
