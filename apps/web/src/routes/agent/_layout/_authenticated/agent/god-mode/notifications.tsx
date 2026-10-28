import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { NotificationProviderEditor } from "@/components/god-mode/notification-provider-editor";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/notifications",
)({ component: NotificationProvidersRoute });
function NotificationProvidersRoute() {
  const { t } = useTranslation("notificationProvider");
  const isAdmin = useInstanceAdminSignal();
  return (
    <section className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
      <PageTitle title={t("title")} />
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {isAdmin ? <NotificationProviderEditor /> : <IdentityAccessDenied />}
    </section>
  );
}
