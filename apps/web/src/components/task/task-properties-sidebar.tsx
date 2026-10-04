import {
  Badge,
  Button,
  KbdSequence,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { Copy, GitBranch, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { resolveLabelColor } from "@/lib/label-color";
import { toast } from "@/lib/toast";
import TaskLabelsPopover from "./task-labels-popover";
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
  className?: string;
  compact?: boolean;
};

export default function TaskPropertiesSidebar({
  taskId,
  projectId,
  workspaceId,
  className,
  compact = false,
}: TaskPropertiesSidebarProps) {
  const { t } = useTranslation();
  const { data: task } = useGetTask(taskId ?? "");
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const {
    data: columns = [],
    isLoading: columnsLoading,
    isError: columnsError,
  } = useGetColumns(projectId);
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: taskLabels = [] } = useGetLabelsByTask(taskId ?? "");
  const { data: workspaceProjects = [] } = useGetProjects({ workspaceId });
  const canMoveTask =
    Boolean(task) && workspaceProjects.some((p) => p.id !== task?.projectId);
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
              columns={columns}
              workspaceUsers={workspaceUsers}
              compact={false}
              columnsLoading={columnsLoading}
              columnsError={columnsError}
            />
          </div>
        )}

        <div className="hidden lg:flex px-3 flex-col gap-3 p-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground px-2">
              {t("tasks:properties.labels")}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 px-2">
              {task &&
                taskLabels.length > 0 &&
                taskLabels.map(
                  (label: { id: string; name: string; color: string }) => (
                    <TaskLabelsPopover
                      key={`edit-${label.id}`}
                      task={task}
                      workspaceId={workspaceId}
                      triggerNativeButton={false}
                    >
                      <Badge
                        variant="outline"
                        className="flex items-center gap-1 px-1.5 py-0.5 cursor-pointer hover:bg-accent/50 transition-colors text-[10px]"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: resolveLabelColor(label.color),
                          }}
                        />
                        <span className="truncate max-w-[60px]">
                          {label.name}
                        </span>
                      </Badge>
                    </TaskLabelsPopover>
                  ),
                )}

              {task && (
                <TaskLabelsPopover task={task} workspaceId={workspaceId}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 rounded-full"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </TaskLabelsPopover>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
