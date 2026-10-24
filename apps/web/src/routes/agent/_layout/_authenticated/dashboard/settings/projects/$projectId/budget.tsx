import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
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
  return (
    <div className="max-w-4xl mx-auto">
      <PageTitle title={t("timeTracking:budget.title")} />
      <div className="space-y-6">
        <ProjectBillableSetting projectId={projectId} />
        <ProjectBudget projectId={projectId} />
      </div>
    </div>
  );
}
