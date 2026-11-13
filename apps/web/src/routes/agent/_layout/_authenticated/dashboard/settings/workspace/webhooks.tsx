import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useSettingsAccess } from "@/components/settings/settings-access";
import { SettingsAccessPage } from "@/components/settings/settings-access-page";
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
    return (
      <SettingsAccessPage
        access={access}
        titleKey="webhooks:list.title"
        descriptionKey="webhooks:list.description"
      />
    );
  if (location.pathname.startsWith(`${routes.webhooks.path}/`))
    return <Outlet />;
  return <WebhookList />;
}
