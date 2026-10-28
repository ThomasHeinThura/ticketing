import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceStateTemplatesPage } from "@/components/settings/workspace-state-templates-panel";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/states",
)({
  component: WorkspaceStateTemplatesPage,
});
