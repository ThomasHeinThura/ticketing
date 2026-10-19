import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ProjectGeneralSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings",
)({
  component: ProjectSettingsRootRoute,
});

function ProjectSettingsRootRoute() {
  const { projectKey } = Route.useParams();
  const location = useLocation();
  const encodedBase = `/agent/projects/${encodeURIComponent(projectKey)}/settings`;
  const rawBase = `/agent/projects/${projectKey}/settings`;
  if (
    location.pathname !== encodedBase &&
    location.pathname !== `${encodedBase}/` &&
    location.pathname !== rawBase &&
    location.pathname !== `${rawBase}/`
  ) {
    return <Outlet />;
  }
  return <ProjectGeneralSettingsScreen projectKey={projectKey} />;
}
