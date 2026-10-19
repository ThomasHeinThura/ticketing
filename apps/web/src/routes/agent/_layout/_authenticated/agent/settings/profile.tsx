import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { ProfileGeneralSettingsScreen } from "@/components/agent/p1-core-and-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile",
)({
  component: ProfileSettingsRootRoute,
});

function ProfileSettingsRootRoute() {
  const location = useLocation();
  if (
    location.pathname !== "/agent/settings/profile" &&
    location.pathname !== "/agent/settings/profile/"
  ) {
    return <Outlet />;
  }
  return <ProfileGeneralSettingsScreen />;
}
