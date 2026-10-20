import { createFileRoute } from "@tanstack/react-router";
import { ProjectStakeholdersScreen } from "@/components/agent/p2-service-desk-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/stakeholders",
)({
  component: ProjectStakeholdersRoute,
});

function ProjectStakeholdersRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectStakeholdersScreen projectKey={projectKey} />;
}
