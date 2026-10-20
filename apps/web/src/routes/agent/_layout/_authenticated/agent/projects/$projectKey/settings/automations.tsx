import { createFileRoute } from "@tanstack/react-router";
import { ProjectAutomationsSettingsScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/automations",
)({
  component: ProjectAutomationsSettingsRouteComponent,
});

function ProjectAutomationsSettingsRouteComponent() {
  const { projectKey } = Route.useParams() as { projectKey: string };
  return <ProjectAutomationsSettingsScreen projectKey={projectKey} />;
}
