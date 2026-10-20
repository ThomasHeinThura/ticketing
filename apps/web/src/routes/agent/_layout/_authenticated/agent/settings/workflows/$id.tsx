import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceWorkflowEditorScreen } from "@/components/agent/p2-service-desk-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/workflows/$id",
)({
  component: WorkspaceWorkflowEditorRoute,
});

function WorkspaceWorkflowEditorRoute() {
  const { id } = Route.useParams();
  return <WorkspaceWorkflowEditorScreen id={id} />;
}
