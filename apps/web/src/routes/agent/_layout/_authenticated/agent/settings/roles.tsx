import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WorkspaceRolesListScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/roles",
)({
  component: WorkspaceRolesRouteComponent,
});

function WorkspaceRolesRouteComponent() {
  const location = useLocation();
  if (location.pathname.startsWith("/agent/settings/roles/")) {
    return <Outlet />;
  }
  return <WorkspaceRolesListScreen />;
}
