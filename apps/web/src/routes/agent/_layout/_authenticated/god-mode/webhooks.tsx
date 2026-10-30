import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { WebhookSecurityPosturePanel } from "@/components/god-mode/webhook-security-posture-panel";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/webhooks",
)({ component: GodModeWebhooksRoute });

function GodModeWebhooksRoute() {
  const { t } = useTranslation("godModeWebhooks");
  const isAdmin = useInstanceAdminSignal();

  return (
    <section className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
      <PageTitle title={t("title")} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {isAdmin ? <WebhookSecurityPosturePanel /> : <IdentityAccessDenied />}
    </section>
  );
}
