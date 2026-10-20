import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AccountSettingsFrame } from "@/components/settings/account-settings-frame";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account",
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <AccountSettingsFrame>
      <Outlet />
    </AccountSettingsFrame>
  );
}
