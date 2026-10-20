import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WorkspaceTeamsListScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/teams",
)({
  component: WorkspaceTeamsRouteComponent,
});

function WorkspaceTeamsRouteComponent() {
  const location = useLocation();
  if (location.pathname.startsWith("/agent/settings/teams/")) {
    return <Outlet />;
  }
  return <WorkspaceTeamsListScreen />;
}
