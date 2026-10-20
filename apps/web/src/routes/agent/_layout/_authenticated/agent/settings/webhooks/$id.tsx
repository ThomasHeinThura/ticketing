import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WorkspaceWebhookEditorScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/webhooks/$id",
)({
  component: WorkspaceWebhookEditorRouteComponent,
});

function WorkspaceWebhookEditorRouteComponent() {
  const location = useLocation();
  const { id } = Route.useParams() as { id: string };
  if (location.pathname.endsWith("/deliveries")) {
    return <Outlet />;
  }
  return <WorkspaceWebhookEditorScreen id={id} />;
}
