import {
  createFileRoute,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile",
)({
  component: ProfileSettingsRootRoute,
});

// Profile settings are kaneo's account settings; only v2 additions (pending actions) live here.
function ProfileSettingsRootRoute() {
  const location = useLocation();
  if (
    location.pathname === "/agent/settings/profile" ||
    location.pathname === "/agent/settings/profile/"
  ) {
    return <Navigate to="/dashboard/settings/account/information" replace />;
  }
  return <Outlet />;
}
