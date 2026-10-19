import { createFileRoute } from "@tanstack/react-router";
import { ProjectStatesSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/states",
)({
  component: ProjectStatesRoute,
});

function ProjectStatesRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectStatesSettingsScreen projectKey={projectKey} />;
}
