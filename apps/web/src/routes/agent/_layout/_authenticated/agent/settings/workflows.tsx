import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WorkspaceWorkflowsListScreen } from "@/components/agent/p2-service-desk-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/workflows",
)({
  component: WorkspaceWorkflowsRoute,
});

function WorkspaceWorkflowsRoute() {
  const location = useLocation();
  if (location.pathname.startsWith("/agent/settings/workflows/")) {
    return <Outlet />;
  }
  return <WorkspaceWorkflowsListScreen />;
}
