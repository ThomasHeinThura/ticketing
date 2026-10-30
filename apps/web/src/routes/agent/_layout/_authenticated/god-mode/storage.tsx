import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { StorageUsagePanel } from "@/components/god-mode/storage-usage-panel";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/storage",
)({ component: GodModeStorageRoute });

function GodModeStorageRoute() {
  const { t } = useTranslation("godModeStorage");
  const isAdmin = useInstanceAdminSignal();

  return (
    <>
      <PageTitle title={t("title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </header>
        {isAdmin ? <StorageUsagePanel /> : <IdentityAccessDenied />}
      </div>
    </>
  );
}
