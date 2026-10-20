import { createFileRoute } from "@tanstack/react-router";
import { ProjectPlanScreen } from "@/components/agent/p2-service-desk-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/plan",
)({
  component: ProjectPlanRoute,
});

function ProjectPlanRoute() {
  const { projectKey } = Route.useParams();
  return <ProjectPlanScreen projectKey={projectKey} />;
}
