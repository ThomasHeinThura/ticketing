import { createFileRoute } from "@tanstack/react-router";
import { TeamPage } from "@/components/project/overview/team-page";

/** S3 project Overview tab: `/agent/projects/{key}/team`. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/team",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <TeamPage projectKey={projectKey} />;
}
