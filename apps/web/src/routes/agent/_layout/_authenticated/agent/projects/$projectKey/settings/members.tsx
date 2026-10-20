import { createFileRoute } from "@tanstack/react-router";
import { ProjectSettingsRedirect } from "@/components/agent/kaneo-redirects";

// The real screen is kaneo's project settings (/dashboard/settings/projects/{id}/general).
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/members",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <ProjectSettingsRedirect projectKey={projectKey} section="general" />;
}
