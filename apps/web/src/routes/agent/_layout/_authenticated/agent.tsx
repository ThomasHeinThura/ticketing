import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { AgentWorkspaceHomeScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute("/_layout/_authenticated/agent")({
  component: AgentRootRoute,
});

function AgentRootRoute() {
  const location = useLocation();
  if (location.pathname !== "/agent" && location.pathname !== "/agent/") {
    return <Outlet />;
  }
  return <AgentWorkspaceHomeScreen />;
}
