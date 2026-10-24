import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { TeamsList } from "@/components/settings/teams/teams-list";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/teams",
)({
  component: TeamsRoute,
});

function TeamsRoute() {
  const { pathname } = useLocation();
  if (pathname.startsWith(`${routes.workspaceTeams.path}/`)) return <Outlet />;
  return <TeamsList />;
}
