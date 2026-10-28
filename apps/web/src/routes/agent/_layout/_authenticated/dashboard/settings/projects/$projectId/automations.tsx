import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { AutomationRulesPanel } from "@/components/automation/automation-rules-panel";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/automations",
)({
  component: RouteComponent,
});

/**
 * Project automations: the Kaneo project settings page behind
 * `/agent/projects/{key}/settings/automations`. The API addresses a project's rules by its key.
 */
function RouteComponent() {
  const { t } = useTranslation("automations");
  const { projectId } = Route.useParams();
  const { workspace } = useWorkspacePermission();
  // Project authority is decided at this project (an inherited or project-only grant counts),
  // not by the workspace role alone.
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
        aria-label={t("list.loading")}
      >
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (!project)
    return (
      <div className="max-w-4xl mx-auto">
        <Alert variant="error">
          <AlertTitle>{t("project.notFoundTitle")}</AlertTitle>
          <AlertDescription>
            {t("project.notFoundDescription")}
          </AlertDescription>
        </Alert>
      </div>
    );
  return (
    <div className="max-w-4xl mx-auto">
      <AutomationRulesPanel
        scope={{ kind: "project", projectKey: project.slug }}
        workspaceId={workspace.id}
        projectId={project.id}
        canManage={canManageProjectSettings()}
        title={t("project.title")}
        description={t("project.description")}
      />
    </div>
  );
}
