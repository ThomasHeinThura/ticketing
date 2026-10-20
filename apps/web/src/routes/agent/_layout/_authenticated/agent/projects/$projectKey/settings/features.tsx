import { createFileRoute } from "@tanstack/react-router";
import { ProjectFeaturesSettingsScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/settings/features",
)({
  component: ProjectFeaturesSettingsRouteComponent,
});

function ProjectFeaturesSettingsRouteComponent() {
  const { projectKey } = Route.useParams() as { projectKey: string };
  return <ProjectFeaturesSettingsScreen projectKey={projectKey} />;
}
