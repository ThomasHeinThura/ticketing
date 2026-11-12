import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import ProjectStatesEditor from "@/components/project/project-states-editor";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/workflow",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();

  return (
    <>
      <PageTitle title={t("settings:projectWorkflow.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:projectWorkflow.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:projectWorkflow.subtitle")}
          </p>
        </div>

        {workspace?.id && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:projectWorkflow.statesTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings:projectWorkflow.statesDescription")}
              </p>
            </div>
            <ProjectStatesEditor
              projectId={projectId}
              workspaceId={workspace.id}
            />
          </div>
        )}
      </div>
    </>
  );
}
