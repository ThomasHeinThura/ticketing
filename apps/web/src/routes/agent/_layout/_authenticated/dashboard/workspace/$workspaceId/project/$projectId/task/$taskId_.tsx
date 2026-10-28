import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import TaskLayout from "@/components/common/task-layout";
import PageTitle from "@/components/page-title";
import { TaskDetailsSkeleton } from "@/components/task/task-page-skeleton";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId_",
)({
  component: RouteComponent,
});

/**
 * Old `/dashboard/.../task/{taskId}` links keep working: the legacy task id resolves to its
 * project key and number, which is the canonical work item key (`/agent/work-items/{key}`).
 * The legacy detail view and its delete control are gone (deletion is a pending action on the
 * work item since P0).
 */
function RouteComponent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectId, workspaceId, taskId } = Route.useParams();
  const { data: task, isLoading: isTaskLoading } = useGetTask(taskId);
  const { data: project, isLoading: isProjectLoading } = useGetProject({
    id: projectId,
    workspaceId,
  });
  const isLoading = isTaskLoading || isProjectLoading;

  if (!isLoading && task && project?.slug && task.number) {
    return (
      <Navigate
        to={
          routes.workItemDetail.build({
            key: `${project.slug}-${task.number}`,
          }) as never
        }
        replace
      />
    );
  }

  return (
    <TaskLayout
      taskId={taskId}
      projectId={projectId}
      workspaceId={workspaceId}
      projectName={project?.name}
      projectSlug={project?.slug}
      taskNumber={task?.number}
    >
      <PageTitle
        title={
          isLoading
            ? t("tasks:common.loadingTask")
            : t("tasks:common.taskNotFound")
        }
        hideAppName
      />
      {isLoading ? (
        <TaskDetailsSkeleton />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-12 text-center">
          <h1 className="text-2xl font-bold">
            {t("tasks:common.taskNotFound")}
          </h1>
          <p className="text-muted-foreground max-w-md">
            {t("tasks:common.taskNotFoundDescription", {
              defaultValue:
                "The task you are looking for does not exist or has been deleted.",
            })}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                params: { workspaceId, projectId },
              })
            }
          >
            {t("navigation:sidebar.backToBoard", {
              defaultValue: "Back to board",
            })}
          </Button>
        </div>
      )}
    </TaskLayout>
  );
}
