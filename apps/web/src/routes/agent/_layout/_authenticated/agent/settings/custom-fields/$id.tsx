import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceCustomFieldEditorScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/custom-fields/$id",
)({
  component: WorkspaceCustomFieldEditorRouteComponent,
});

function WorkspaceCustomFieldEditorRouteComponent() {
  const { id } = Route.useParams() as { id: string };
  return <WorkspaceCustomFieldEditorScreen id={id} />;
}
