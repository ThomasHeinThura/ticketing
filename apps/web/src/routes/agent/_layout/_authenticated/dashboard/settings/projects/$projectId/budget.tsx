import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  SettingsAccessChecking,
  SettingsAccessDenied,
  SettingsAccessError,
  useSettingsAccess,
} from "@/components/settings/settings-access";
import { ProjectBudget } from "@/components/time-tracking/project-budget";
import { ProjectBillableSetting } from "@/components/time-tracking/time-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/budget",
)({
  component: RouteComponent,
});

/**
 * Project budget: the Kaneo project settings page behind
 * `/agent/projects/{key}/settings/budget` (`TC-15`..`TC-19`).
 */
function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  // Each section asks only for what its read route allows: the budget needs `budget:read` at this
  // project, the billable default reads `/api/time-settings`, which needs `time_entry:create`.
  const budgetAccess = useSettingsAccess(
    (permission) => permission.canReadBudgets(),
    projectId,
  );
  const timeAccess = useSettingsAccess((permission) => permission.canLogTime());
  const failed = budgetAccess === "error" || timeAccess === "error";
  const checking = budgetAccess === "checking" || timeAccess === "checking";
  return (
    <div className="max-w-4xl mx-auto">
      <PageTitle title={t("timeTracking:budget.title")} />
      <h1 className="sr-only">{t("timeTracking:budget.title")}</h1>
      {failed ? (
        <SettingsAccessError />
      ) : checking ? (
        <SettingsAccessChecking />
      ) : budgetAccess === "denied" && timeAccess === "denied" ? (
        <SettingsAccessDenied />
      ) : (
        <div className="space-y-6">
          {timeAccess === "allowed" ? (
            <ProjectBillableSetting projectId={projectId} />
          ) : null}
          {budgetAccess === "allowed" ? (
            <ProjectBudget projectId={projectId} />
          ) : (
            <SettingsAccessDenied />
          )}
        </div>
      )}
    </div>
  );
}
