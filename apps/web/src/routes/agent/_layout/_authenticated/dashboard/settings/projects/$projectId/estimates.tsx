import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { EstimateSettings } from "@/components/agile/estimate-settings";
import PageTitle from "@/components/page-title";
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
  if (!workspace || isCheckingPermissions || isLoading)
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
  return (
    <div className="max-w-4xl mx-auto">
      <PageTitle title={t("estimates.pageTitle")} />
      <EstimateSettings
        projectKey={project.slug}
        canManage={canManageProjectSettings()}
      />
    </div>
  );
}
