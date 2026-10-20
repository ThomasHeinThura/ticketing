import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// Lazy: every /agent page is a child of this route, so a static import here loaded the
// settings-screen module before any agent page could paint (G11 work-list LCP).
const AgentWorkspaceHomeScreen = lazy(() =>
  import("@/components/agent/p1-core-and-settings").then((module) => ({
    default: module.AgentWorkspaceHomeScreen,
  })),
);

export const Route = createFileRoute("/_layout/_authenticated/agent")({
  component: AgentRootRoute,
});

function AgentRootRoute() {
  const location = useLocation();
  if (location.pathname !== "/agent" && location.pathname !== "/agent/") {
    return <Outlet />;
  }
  return (
    <Suspense fallback={null}>
      <AgentWorkspaceHomeScreen />
    </Suspense>
  );
}
