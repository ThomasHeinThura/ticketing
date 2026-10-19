import { createFileRoute } from "@tanstack/react-router";
import { ProjectDangerZoneSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/danger",
)({
  component: ProjectDangerZoneRoute,
});

function ProjectDangerZoneRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectDangerZoneSettingsScreen projectKey={projectKey} />;
}
