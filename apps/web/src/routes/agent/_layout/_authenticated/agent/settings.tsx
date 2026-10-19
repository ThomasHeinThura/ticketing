import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { WorkspaceGeneralSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute("/_layout/_authenticated/agent/settings")({
  component: WorkspaceSettingsRootRoute,
});

function WorkspaceSettingsRootRoute() {
  const location = useLocation();
  if (
    location.pathname !== "/agent/settings" &&
    location.pathname !== "/agent/settings/"
  ) {
    return <Outlet />;
  }
  return <WorkspaceGeneralSettingsScreen />;
}
