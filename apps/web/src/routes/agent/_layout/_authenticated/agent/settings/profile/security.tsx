import { createFileRoute } from "@tanstack/react-router";
import { ProfileSecuritySettingsScreen } from "@/components/portal/p3-portal-and-identity-screens";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile/security",
)({
  component: ProfileSecuritySettingsScreen,
});
