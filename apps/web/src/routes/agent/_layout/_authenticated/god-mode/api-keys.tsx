import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { InstanceApiKeysPanel } from "@/components/god-mode/instance-api-keys-panel";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/api-keys",
)({ component: GodModeApiKeysRoute });

function GodModeApiKeysRoute() {
  const { t } = useTranslation("settings");
  const isAdmin = useInstanceAdminSignal();
  return (
    <section className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
      <PageTitle title={t("instanceApiKeys.title")} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("instanceApiKeys.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("instanceApiKeys.description")}
        </p>
      </div>
      {isAdmin ? <InstanceApiKeysPanel /> : <IdentityAccessDenied />}
    </section>
  );
}
