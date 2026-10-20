import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceRoleEditorScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/roles/$id",
)({
  component: WorkspaceRoleEditorRouteComponent,
});

function WorkspaceRoleEditorRouteComponent() {
  const { id } = Route.useParams() as { id: string };
  return <WorkspaceRoleEditorScreen id={id} />;
}
