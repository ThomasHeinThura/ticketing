import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ProjectOverviewScreen } from "@/components/agent/p1-core-and-settings";

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
  return <ProjectOverviewScreen projectKey={projectKey} />;
}
