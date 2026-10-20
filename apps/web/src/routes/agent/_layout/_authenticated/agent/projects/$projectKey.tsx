import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// Lazy: this route is the parent of the work list, and a static import put the whole
// settings-screen module on the work list's critical path (G11 work-list LCP).
const ProjectOverviewScreen = lazy(() =>
  import("@/components/agent/p1-core-and-settings").then((module) => ({
    default: module.ProjectOverviewScreen,
  })),
);

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey",
)({
  component: ProjectRootRoute,
});

function ProjectRootRoute() {
  const { projectKey } = Route.useParams();
  const location = useLocation();
  const encodedBase = `/agent/projects/${encodeURIComponent(projectKey)}`;
  const rawBase = `/agent/projects/${projectKey}`;
  if (
    location.pathname !== encodedBase &&
    location.pathname !== `${encodedBase}/` &&
    location.pathname !== rawBase &&
    location.pathname !== `${rawBase}/`
  ) {
    return <Outlet />;
  }
  return (
    <Suspense fallback={null}>
      <ProjectOverviewScreen projectKey={projectKey} />
    </Suspense>
  );
}
