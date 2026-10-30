import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { InstanceJobsPanel } from "@/components/god-mode/instance-jobs-panel";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";

export const Route = createFileRoute("/_layout/_authenticated/god-mode/jobs")({
  component: GodModeJobsRoute,
});

function GodModeJobsRoute() {
  const { t } = useTranslation();
  const isAdmin = useInstanceAdminSignal();
  const title = t("godModeJobs:title", { defaultValue: "Background jobs" });
  return (
    <>
      <PageTitle title={title} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {t("godModeJobs:description", {
              defaultValue:
                "Review registered jobs, schedules, and recent run status.",
            })}
          </p>
        </header>
        {isAdmin ? <InstanceJobsPanel /> : <IdentityAccessDenied />}
      </div>
    </>
  );
}
