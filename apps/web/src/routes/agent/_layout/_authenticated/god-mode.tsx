import { createFileRoute, Outlet } from "@tanstack/react-router";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { InstanceSettingsFrame } from "@/components/settings/instance-settings-frame";
import { SettingsShell } from "@/components/settings/settings-shell";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";

/**
 * God Mode at the agent host root (L-03, Thomas 30 Oct, option A). The parent `_authenticated`
 * guard sends a signed-out visitor to `/god-mode/sign-in` and still enforces MFA enrolment; a
 * signed-in non-admin sees the access-denied screen. The API (`requireCurrentInstanceAdmin`,
 * `instance:admin`, session only) stays the authority for every request.
 */
export const Route = createFileRoute("/_layout/_authenticated/god-mode")({
  component: InstanceSettingsRoute,
});
function InstanceSettingsRoute() {
  const isAdmin = useInstanceAdminSignal();
  return (
    <SettingsShell scope="instance">
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
