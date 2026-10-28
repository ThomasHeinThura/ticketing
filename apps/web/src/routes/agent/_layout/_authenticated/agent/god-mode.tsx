import { createFileRoute, Outlet } from "@tanstack/react-router";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { InstanceSettingsFrame } from "@/components/settings/instance-settings-frame";
import { SettingsShell } from "@/components/settings/settings-shell";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
export const Route = createFileRoute("/_layout/_authenticated/agent/god-mode")({
  component: InstanceSettingsRoute,
});
function InstanceSettingsRoute() {
  const isAdmin = useInstanceAdminSignal();
  return (
    <SettingsShell instance>
      {isAdmin ? (
        <InstanceSettingsFrame>
          <Outlet />
        </InstanceSettingsFrame>
      ) : (
        <IdentityAccessDenied />
      )}
    </SettingsShell>
  );
}
