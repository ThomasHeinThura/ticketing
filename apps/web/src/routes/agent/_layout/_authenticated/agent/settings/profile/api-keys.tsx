import { createFileRoute } from "@tanstack/react-router";
import { ProfileApiKeysSettingsScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/api-keys",
)({
  component: ProfileApiKeysSettingsScreen,
});
