import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import PageTitle from "@/components/page-title";
import { FeatureFlagsPanel } from "@/components/settings/feature-flags-panel";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/features",
)({ component: GodModeFeaturesRoute });

function GodModeFeaturesRoute() {
  const { t } = useTranslation("featureFlags");
  const isAdmin = useInstanceAdminSignal();
  return (
    <section className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
      <PageTitle title={t("page.godModeTitle")} />
      <h1 className="text-2xl font-semibold">{t("page.godModeTitle")}</h1>
      {isAdmin ? (
        <FeatureFlagsPanel target={{ level: "instance" }} />
      ) : (
        <IdentityAccessDenied />
      )}
    </section>
  );
}
