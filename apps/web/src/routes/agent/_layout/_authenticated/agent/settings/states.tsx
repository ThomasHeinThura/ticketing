import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceStatesSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/states",
)({
  component: WorkspaceStatesSettingsScreen,
});
