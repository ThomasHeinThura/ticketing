import {
  Button,
  KbdSequence,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { Copy, GitBranch } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import type { Project } from "@/types/project";
import type Task from "@/types/task";
import TaskLabelsSection from "./task-labels-section";
import TaskMovePopover from "./task-move-popover";
import TaskPropertiesControls from "./task-properties-controls";

function slugify(text: string | undefined): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function generateBranchName(
  pattern: string,
  projectSlug: string | undefined,
  taskNumber: number | null | undefined,
  taskTitle: string | undefined,
): string {
  if (!projectSlug || !taskNumber) return "";
  return pattern
    .replace("{slug}", projectSlug.toLowerCase())
    .replace("{number}", taskNumber.toString())
    .replace("{title}", slugify(taskTitle));
}

type TaskPropertiesSidebarProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  task?: Task;
  project?: Project;
  className?: string;
  compact?: boolean;
};

type TaskPropertiesSummary = Pick<
  Task,
  | "id"
  | "projectId"
  | "number"
  | "title"
  | "status"
  | "priority"
  | "userId"
  | "assigneeId"
  | "assigneeName"
  | "startDate"
  | "dueDate"
>;

function selectTaskPropertiesSummary(task: Task): TaskPropertiesSummary {
  return {
    id: task.id,
    projectId: task.projectId,
    number: task.number,
    title: task.title,
    status: task.status,
    priority: task.priority,
    userId: task.userId,
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeName,
    startDate: task.startDate,
    dueDate: task.dueDate,
  };
}

export default function TaskPropertiesSidebar({
  taskId,
  projectId,
  workspaceId,
  task: providedTask,
  project: providedProject,
  className,
  compact = false,
}: TaskPropertiesSidebarProps) {
  const { t } = useTranslation();
  const { data: fetchedTask } = useGetTask(
    taskId ?? "",
    selectTaskPropertiesSummary,
    !providedTask,
  );
  const { data: fetchedProject } = useGetProject({
    id: providedProject ? "" : projectId,
    workspaceId,
  });
  const task = providedTask ?? fetchedTask;
  const project = providedProject ?? fetchedProject;
  const {
    data: columns = [],
    isLoading: columnsLoading,
    isError: columnsError,
  } = useGetColumns(projectId);
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: taskLabels = [] } = useGetLabelsByTask(taskId ?? "");
  const selectCanMoveTask = useCallback(
    (workspaceProjects: Array<{ id: string }> | undefined) =>
      Boolean(task?.projectId) &&
      (workspaceProjects ?? []).some(
        (workspaceProject) => workspaceProject.id !== task?.projectId,
      ),
    [task?.projectId],
  );
  const { data: canMoveTask = false } = useGetProjects(
    { workspaceId },
    true,
    selectCanMoveTask,
  );
  const projectSlug = project?.slug;
  const taskNumber = task?.number;
  // The per-project branch pattern came from the GitHub and Gitea integrations,
  // both deleted in issue #6. The default stands until a TaskDesk dev-links
  // feature defines its own (feature.dev_links).
  const branchPattern = "{slug}-{number}";

  const handleCopyTaskLink = () => {
    navigator.clipboard.writeText(
      `${window.location.origin}/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`,
    );
    toast.message(t("tasks:properties.copyTaskLink"));
  };

  const handleCopyTaskBranch = () => {
    const branchName = generateBranchName(
      branchPattern,
      projectSlug,
      taskNumber,
      task?.title,
    );
    navigator.clipboard.writeText(branchName);
    toast.message(t("tasks:properties.copyTaskBranch"));
  };

  return (
    <div className={className}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {/* Compact mode: properties + icons in one row */}
        {compact && (
          <div className="flex flex-row-reverse gap-2 w-full border-b border-border">
            <div className="flex px-3 py-2">
              {task && canMoveTask && (
                <TaskMovePopover
                  task={task}
                  workspaceId={workspaceId}
                  triggerClassName="rounded-l-md rounded-r-none border-r-0"
                />
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "text-foreground border-r-0",
                        canMoveTask ? "rounded-none" : "rounded-r-none",
                      )}
                      onClick={() => handleCopyTaskLink()}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <KbdSequence
                      keys={["Ctrl", "Shift", "C"]}
                      description={t("tasks:properties.copyTaskLink")}
                      separator=""
                    />
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-foreground rounded-l-none"
                      onClick={() => handleCopyTaskBranch()}
                    >
                      <GitBranch className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <KbdSequence
                      keys={["Ctrl", "Shift", "G"]}
                      description={t("tasks:properties.copyTaskBranch")}
                      separator=""
                    />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <TaskPropertiesControls
              task={task}
              taskForMutation={providedTask}
              columns={columns}
              workspaceUsers={workspaceUsers}
              compact
              columnsLoading={columnsLoading}
              columnsError={columnsError}
            />
          </div>
        )}

        {!compact && (
          <div className="flex flex-row-reverse gap-2 w-full border-b border-border lg:flex-col lg:gap-0 lg:border-b-0">
            <div className="flex px-3 py-2 lg:hidden">
              {task && canMoveTask && (
                <TaskMovePopover
                  task={task}
                  workspaceId={workspaceId}
                  triggerClassName="rounded-l-md rounded-r-none border-r-0"
                />
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "text-foreground border-r-0",
                        canMoveTask ? "rounded-none" : "rounded-r-none",
                      )}
                      onClick={() => handleCopyTaskLink()}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <KbdSequence
                      keys={["Ctrl", "Shift", "C"]}
                      description={t("tasks:properties.copyTaskLink")}
                      separator=""
                    />
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-foreground rounded-l-none"
                      onClick={() => handleCopyTaskBranch()}
                    >
                      <GitBranch className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <KbdSequence
                      keys={["Ctrl", "Shift", "G"]}
                      description={t("tasks:properties.copyTaskBranch")}
                      separator=""
                    />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="hidden lg:flex items-center justify-between px-3 py-2 border-b border-border lg:border-none">
              <p className="text-sm font-medium text-foreground flex-1">
                {t("tasks:properties.title")}
              </p>
              <div className="flex">
                {task && canMoveTask && (
                  <TaskMovePopover
                    task={task}
                    workspaceId={workspaceId}
                    triggerClassName="rounded-l-md rounded-r-none border-r-0"
                  />
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "text-foreground border-r-0",
                          canMoveTask ? "rounded-none" : "rounded-r-none",
                        )}
                        onClick={() => handleCopyTaskLink()}
                      >
                        <Copy className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <KbdSequence
                        keys={["Ctrl", "Shift", "C"]}
                        description={t("tasks:properties.copyTaskLink")}
                        separator=""
                      />
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-foreground rounded-l-none"
                        onClick={() => handleCopyTaskBranch()}
                      >
                        <GitBranch className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <KbdSequence
                        keys={["Ctrl", "Shift", "G"]}
                        description={t("tasks:properties.copyTaskBranch")}
                        separator=""
                      />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <TaskPropertiesControls
              task={task}
              taskForMutation={providedTask}
              columns={columns}
              workspaceUsers={workspaceUsers}
              compact={false}
              columnsLoading={columnsLoading}
              columnsError={columnsError}
            />
          </div>
        )}

        {task && (
          <TaskLabelsSection
            taskId={task.id}
            projectId={task.projectId}
            workspaceId={workspaceId}
            taskLabels={taskLabels}
            heading={t("tasks:properties.labels")}
          />
        )}
      </div>
    </div>
  );
}
