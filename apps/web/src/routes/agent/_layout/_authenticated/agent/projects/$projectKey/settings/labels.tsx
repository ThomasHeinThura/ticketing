import { createFileRoute } from "@tanstack/react-router";
import { ProjectLabelsSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/labels",
)({
  component: ProjectLabelsRoute,
});

function ProjectLabelsRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectLabelsSettingsScreen projectKey={projectKey} />;
}
