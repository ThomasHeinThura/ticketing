import { createFileRoute } from "@tanstack/react-router";
import { PrerequisitesPage } from "@/components/project/overview/prerequisites-page";

/** S3 project Overview tab: `/agent/projects/{key}/prerequisites`. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/prerequisites",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <PrerequisitesPage projectKey={projectKey} />;
}
