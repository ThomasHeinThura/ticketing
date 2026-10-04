import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { Maximize2, X } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import useGetActivitiesByTaskId from "@/hooks/queries/activity/use-get-activities-by-task-id";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetTask from "@/hooks/queries/task/use-get-task";
import TaskDeleteButton from "./task-delete-button";
import TaskDetailsContent from "./task-details-content";
import TaskPropertiesSidebar from "./task-properties-sidebar";

type TaskDetailsSheetBodyProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  onClose: () => void;
};

export default function TaskDetailsSheetBody({
  taskId,
  projectId,
  workspaceId,
  onClose,
}: TaskDetailsSheetBodyProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: task } = useGetTask(taskId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: activities = [] } = useGetActivitiesByTaskId(taskId);

  const handleOpenFullPage = useCallback(() => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: {
        workspaceId,
        projectId,
        taskId,
      },
    });
  }, [navigate, workspaceId, projectId, taskId]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {project?.slug}-{task?.number}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <TaskDeleteButton taskId={taskId} onDeleted={onClose} />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenFullPage}
                  className="text-foreground"
                >
                  <Maximize2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("tasks:detail.openInFullPage")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <TaskPropertiesSidebar
          taskId={taskId}
          projectId={projectId}
          workspaceId={workspaceId}
          task={task}
          project={project}
          className="w-full bg-sidebar border-b border-border flex flex-col gap-0 overflow-y-auto shrink-0"
          compact={true}
        />

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-4 py-4">
            <TaskDetailsContent
              taskId={taskId}
              projectId={projectId}
              workspaceId={workspaceId}
              task={task}
              project={project}
              activities={activities}
              className="flex flex-col gap-3"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
