import { createFileRoute } from "@tanstack/react-router";
import { GodModePluginsScreen } from "@/components/agent/p4-god-mode-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/plugins",
)({
  component: GodModePluginsScreen,
});
