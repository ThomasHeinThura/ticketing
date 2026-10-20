import {
  createFileRoute,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { AccountSettingsFrame } from "@/components/settings/account-settings-frame";
import { SettingsShell } from "@/components/settings/settings-shell";
import { WorkspaceSettingsFrame } from "@/components/settings/workspace-settings-frame";
import { ensureActiveWorkspace } from "@/lib/ensure-active-workspace";

export const Route = createFileRoute("/_layout/_authenticated/agent/settings")({
  beforeLoad: ensureActiveWorkspace,
  component: AgentSettingsRoute,
});

// The v2 settings pages (calendars, SLA policies, request types, pending actions) render in
// kaneo's own settings shell and sidebars, next to kaneo's pages under /dashboard/settings.
function AgentSettingsRoute() {
  const { pathname } = useLocation();
  if (pathname === "/agent/settings" || pathname === "/agent/settings/") {
    return <Navigate to="/dashboard/settings/workspace/general" replace />;
  }
  const Frame = pathname.startsWith("/agent/settings/profile")
    ? AccountSettingsFrame
    : WorkspaceSettingsFrame;
  return (
    <SettingsShell>
      <Frame>
        <Outlet />
      </Frame>
    </SettingsShell>
  );
}
