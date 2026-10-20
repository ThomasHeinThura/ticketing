import { createFileRoute, Outlet } from "@tanstack/react-router";
import { WorkspaceSettingsFrame } from "@/components/settings/workspace-settings-frame";
import { ensureActiveWorkspace } from "@/lib/ensure-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace",
)({
  beforeLoad: ensureActiveWorkspace,
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <WorkspaceSettingsFrame>
      <Outlet />
    </WorkspaceSettingsFrame>
  );
}
