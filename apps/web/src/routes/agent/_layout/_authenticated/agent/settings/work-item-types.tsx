import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceWorkItemTypesScreen } from "@/components/agent/p2-service-desk-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/work-item-types",
)({
  component: WorkspaceWorkItemTypesScreen,
});
