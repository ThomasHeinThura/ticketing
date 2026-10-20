import { createFileRoute } from "@tanstack/react-router";
import { ProjectSlaSettingsScreen } from "@/components/agent/p2-service-desk-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/sla",
)({
  component: ProjectSlaSettingsRoute,
});

function ProjectSlaSettingsRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectSlaSettingsScreen projectKey={projectKey} />;
}
