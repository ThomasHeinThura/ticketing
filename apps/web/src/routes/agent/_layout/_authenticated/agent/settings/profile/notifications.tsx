import { createFileRoute } from "@tanstack/react-router";
import { ProfileNotificationsSettingsScreen } from "@/components/agent/p4-governance-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/notifications",
)({
  component: ProfileNotificationsSettingsScreen,
});
