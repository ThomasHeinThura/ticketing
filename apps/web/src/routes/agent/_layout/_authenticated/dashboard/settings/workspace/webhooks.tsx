import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import {
  SettingsAccessGate,
  useSettingsAccess,
} from "@/components/settings/settings-access";
import { WebhookList } from "@/components/webhook/webhook-list";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/webhooks",
)({
  component: WebhooksRoute,
});

function WebhooksRoute() {
  const location = useLocation();
  const access = useSettingsAccess((permission) =>
    permission.canManageWebhooks(),
  );
  if (access !== "allowed")
    return <SettingsAccessGate access={access}>{null}</SettingsAccessGate>;
  if (location.pathname.startsWith(`${routes.webhooks.path}/`))
    return <Outlet />;
  return <WebhookList />;
}
