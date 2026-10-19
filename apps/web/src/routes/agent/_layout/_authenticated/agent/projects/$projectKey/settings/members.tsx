import { createFileRoute } from "@tanstack/react-router";
import { ProjectMembersSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/members",
)({
  component: ProjectMembersRoute,
});

function ProjectMembersRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectMembersSettingsScreen projectKey={projectKey} />;
}
