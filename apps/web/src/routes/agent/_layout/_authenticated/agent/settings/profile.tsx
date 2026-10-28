import {
  createFileRoute,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { profileRedirectTarget } from "@/lib/profile-redirect";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/profile",
)({
  component: ProfileSettingsRootRoute,
});

// Profile settings are kaneo's account settings; only v2 additions (pending actions) live here.
function ProfileSettingsRootRoute() {
  const location = useLocation();
  const target = profileRedirectTarget(location.pathname);
  if (target) {
    return <Navigate to={target} replace />;
  }
  return <Outlet />;
}
