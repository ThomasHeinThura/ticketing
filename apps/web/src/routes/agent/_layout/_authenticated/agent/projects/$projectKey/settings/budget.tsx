import { createFileRoute } from "@tanstack/react-router";
import { ProjectSettingsRedirect } from "@/components/agent/kaneo-redirects";

// The real screen is kaneo's project settings (/dashboard/settings/projects/{id}/budget).
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/budget",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <ProjectSettingsRedirect projectKey={projectKey} section="budget" />;
}
