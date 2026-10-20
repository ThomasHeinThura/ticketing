import { createFileRoute } from "@tanstack/react-router";
import { GodModeStorageScreen } from "@/components/agent/p4-god-mode-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/storage",
)({
  component: GodModeStorageScreen,
});
