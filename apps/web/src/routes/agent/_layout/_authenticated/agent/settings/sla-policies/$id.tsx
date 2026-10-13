import { createFileRoute } from "@tanstack/react-router";
import { SlaPolicyEditor } from "@/components/sla-policy/sla-policy-editor";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/sla-policies/$id",
)({
  component: SlaPolicyEditorRoute,
});

function SlaPolicyEditorRoute() {
  const { id } = Route.useParams();
  return <SlaPolicyEditor id={id} />;
}
