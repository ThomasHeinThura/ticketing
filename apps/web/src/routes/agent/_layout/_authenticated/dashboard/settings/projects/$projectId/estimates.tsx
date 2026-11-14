import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { EstimateSettings } from "@/components/agile/estimate-settings";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import {
  isForbiddenError,
  useCapabilityCheckFailed,
} from "@/components/settings/settings-access";
import { SettingsAccessPage } from "@/components/settings/settings-access-page";
import { getEstimates } from "@/fetchers/agile";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/estimates",
)({
  component: RouteComponent,
});

/**
 * Project estimates: the Kaneo project settings page behind
 * `/agent/projects/{key}/settings/estimates` (`ES-1`, `ES-3`, `CY-6`). The API addresses the
 * project by its key.
 */
function RouteComponent() {
  const { t } = useTranslation("agile");
  const { projectId } = Route.useParams();
  const { workspace } = useWorkspacePermission();
  const { canManageProjectSettings, isCheckingPermissions } =
    useWorkspacePermission(workspace?.id, projectId);
  const { data: projects, isLoading } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find((candidate) => candidate.id === projectId);
  const estimates = useQuery({
    queryKey: ["agile", "estimate-settings", project?.slug ?? ""],
    queryFn: () => getEstimates(project?.slug ?? ""),
    enabled: Boolean(project && !isCheckingPermissions),
    retry: false,
  });
  const checkFailed = useCapabilityCheckFailed(
    isCheckingPermissions ? workspace?.id : undefined,
    projectId,
  );
  if (isCheckingPermissions)
    return (
      <SettingsAccessPage
        access={checkFailed ? "error" : "checking"}
        titleKey="agile:estimates.pageTitle"
      />
    );
  if (!workspace || isLoading)
    return (
      <div
        className="max-w-4xl mx-auto"
        role="status"
        aria-label={t("common.loading")}
      >
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (!project)
    return (
      <div className="max-w-4xl mx-auto">
        <Alert variant="error">
          <AlertTitle>{t("estimates.notFoundTitle")}</AlertTitle>
          <AlertDescription>
            {t("estimates.notFoundDescription")}
          </AlertDescription>
        </Alert>
      </div>
    );
  if (isForbiddenError(estimates.error)) return <NoAccessPage />;
  return (
    <div className="max-w-4xl mx-auto">
      <PageTitle title={t("estimates.pageTitle")} />
      <h1 className="sr-only">{t("estimates.pageTitle")}</h1>
      <EstimateSettings
        projectKey={project.slug}
        canManage={canManageProjectSettings()}
      />
    </div>
  );
}
