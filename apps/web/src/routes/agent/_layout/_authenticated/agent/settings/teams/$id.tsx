import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceTeamDetailScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/teams/$id",
)({
  component: WorkspaceTeamDetailRouteComponent,
});

function WorkspaceTeamDetailRouteComponent() {
  const { id } = Route.useParams() as { id: string };
  return <WorkspaceTeamDetailScreen id={id} />;
}
