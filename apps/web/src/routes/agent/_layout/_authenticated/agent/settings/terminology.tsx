import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceTerminologySettingsScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/terminology",
)({
  component: WorkspaceTerminologySettingsScreen,
});
