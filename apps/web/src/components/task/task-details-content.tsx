import { useNavigate } from "@tanstack/react-router";
import { Timeline } from "@taskdesk/ui";
import { ArrowUpRight } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import Activity from "@/components/activity";
import CommentInput from "@/components/activity/comment-input";
import { isCommentActivity } from "@/components/activity/utils";
import { ExternalLinksAccordion } from "@/components/external-links/external-links-accordion";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import type useGetActivitiesByTaskId from "@/hooks/queries/activity/use-get-activities-by-task-id";
import useExternalLinks from "@/hooks/queries/external-link/use-external-links";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import type { ExternalLink } from "@/types/external-link";
import type { Project } from "@/types/project";
import type Task from "@/types/task";
import TaskDescription from "./task-description";
import TaskRelations from "./task-relations";
import TaskSubtasks from "./task-subtasks";
import TaskTitle from "./task-title";

type TaskDetailsContentProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  task?: Task;
  project?: Project;
  activities: NonNullable<ReturnType<typeof useGetActivitiesByTaskId>["data"]>;
  className?: string;
  dataTestId?: string;
};

function TaskDetailsContent({
  taskId,
  projectId,
  workspaceId,
  task,
  project: providedProject,
  activities,
  className,
  dataTestId,
}: TaskDetailsContentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: fetchedTask } = useGetTask(taskId ?? "", undefined, !task);
  const { data: fetchedProject } = useGetProject({
    id: providedProject ? "" : projectId,
    workspaceId,
  });
  const currentTask = task ?? fetchedTask;
  const project = providedProject ?? fetchedProject;
  const { data: externalLinks = [], isLoading: isLoadingExternalLinks } =
    useExternalLinks(taskId ?? "");
  const { data: relations = [] } = useGetTaskRelations(taskId ?? "");
  const { user } = useAuth();

  const parentRelation = relations.find(
    (rel) => rel.relationType === "subtask" && rel.targetTaskId === taskId,
  );
  const parentTask = parentRelation?.sourceTask;

  if (!taskId) return null;

  return (
    <div className={`${className} gap-4`} data-testid={dataTestId}>
      <div className="flex flex-col gap-2.5">
        {parentTask && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
            onClick={() =>
              navigate({
                to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
                params: {
                  workspaceId,
                  projectId,
                  taskId: parentTask.id,
                },
              })
            }
          >
            <ArrowUpRight className="size-3" />
            <span>
              {t("tasks:detail.subtaskOf")}{" "}
              <span className="font-medium">{parentTask.title}</span>
            </span>
          </button>
        )}
        <p className="text-xs font-semibold text-foreground">
          {project?.slug}-{currentTask?.number}
        </p>
        <TaskTitle taskId={taskId} task={currentTask} />
        <TaskDescription taskId={taskId} task={currentTask} />
      </div>
      {!isLoadingExternalLinks && externalLinks.length > 0 && (
        <div className="mt-4">
          <ExternalLinksAccordion
            externalLinks={externalLinks as ExternalLink[]}
            isLoading={isLoadingExternalLinks}
          />
        </div>
      )}
      <div className="mt-4">
        {taskId && (
          <TaskSubtasks
            taskId={taskId}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        )}
      </div>
      <div className="mt-2">
        <TaskRelations
          taskId={taskId}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      </div>
      <span className="text-sm font-medium text-muted-foreground h-[1px] bg-border w-full block shrink-0" />
      <div className="flex flex-col gap-4">
        <h1 className="text-md font-semibold">{t("tasks:detail.activity")}</h1>
        {user?.id && taskId && <CommentInput taskId={taskId} />}
        {activities.length > 0 ? (
          <Timeline>
            {activities.map((activity, index) => {
              const nextActivity = activities[index + 1];
              const showConnector =
                !isCommentActivity(activity) &&
                Boolean(nextActivity) &&
                !isCommentActivity(nextActivity);

              return (
                <Activity
                  key={activity.id}
                  activity={activity}
                  step={activities.length - index}
                  showConnector={showConnector}
                />
              );
            })}
          </Timeline>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">
            {t("tasks:detail.noActivity")}
          </p>
        )}
      </div>
    </div>
  );
}

export default memo(TaskDetailsContent);
