import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { InstanceDeliveriesPanel } from "@/components/god-mode/instance-deliveries-panel";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/deliveries",
)({ component: GodModeDeliveriesRoute });

function GodModeDeliveriesRoute() {
  const { t } = useTranslation("godModeDeliveries");
  const isAdmin = useInstanceAdminSignal();
  return (
    <section className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
      <PageTitle title={t("title")} />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          {t("description")}
        </p>
      </header>
      {isAdmin ? <InstanceDeliveriesPanel /> : <IdentityAccessDenied />}
    </section>
  );
}
