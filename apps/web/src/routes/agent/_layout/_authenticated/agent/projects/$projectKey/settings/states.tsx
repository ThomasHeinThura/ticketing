import { createFileRoute } from "@tanstack/react-router";
import { ProjectSettingsRedirect } from "@/components/agent/kaneo-redirects";

// Project states live in kaneo's project workflow settings.
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/states",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <ProjectSettingsRedirect projectKey={projectKey} section="workflow" />;
}
