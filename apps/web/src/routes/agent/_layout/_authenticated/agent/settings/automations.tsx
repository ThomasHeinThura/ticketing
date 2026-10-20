import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceAutomationsScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/automations",
)({
  component: WorkspaceAutomationsScreen,
});
