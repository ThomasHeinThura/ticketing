import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@taskdesk/ui";
import { format } from "date-fns";
import type { TFunction } from "i18next";
import {
  Calendar,
  CalendarClock,
  CalendarX,
  GitMerge,
  GitPullRequest,
  SquareCheck,
} from "lucide-react";
import { type CSSProperties, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import type { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { getInitials } from "@/lib/get-initials";
import { getTaskItemStats } from "@/lib/get-task-item-stats";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";
import { TaskLabels } from "./task-labels";

export type TaskCardWorkspaceUser = NonNullable<
  NonNullable<ReturnType<typeof useGetActiveWorkspaceUsers>["data"]>["members"]
>[number];

export type TaskCardProps = {
  task: Task;
  disableDragDrop?: boolean;
  workspaceId?: string;
  workspaceUsersById: ReadonlyMap<string, TaskCardWorkspaceUser>;
  onContextMenuTask: (taskId: string) => void;
  projectSlug: string;
  taskIsCompleted: boolean;
  displayPreferences: TaskCardDisplayPreferences;
  isTaskSelected: boolean;
  isTaskFocused: boolean;
  toggleSelection: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  t: TFunction;
};

export type TaskCardDisplayPreferences = {
  showAssignees: boolean;
  showPriority: boolean;
  showDueDates: boolean;
  showLabels: boolean;
  showTaskNumbers: boolean;
  showTaskItemCounts: boolean;
};

function TaskCard({
  task,
  disableDragDrop = false,
  workspaceId,
  workspaceUsersById,
  onContextMenuTask,
  projectSlug,
  taskIsCompleted,
  displayPreferences,
  isTaskSelected,
  isTaskFocused,
  toggleSelection,
  onOpenTask,
  t,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: disableDragDrop });
  const {
    showAssignees,
    showPriority,
    showDueDates,
    showLabels,
    showTaskNumbers,
    showTaskItemCounts,
  } = displayPreferences;
  const taskItemStats = useMemo(
    () =>
      displayPreferences.showTaskItemCounts
        ? getTaskItemStats(task.description)
        : null,
    [displayPreferences.showTaskItemCounts, task.description],
  );

  const pullRequests = useMemo(() => {
    return (task.externalLinks ?? []).filter(
      (link) => link.resourceType === "pull_request",
    );
  }, [task.externalLinks]);

  const getPRInfo = (pr: (typeof pullRequests)[number]) => {
    const isMerged = pr.metadata?.merged === true;
    const isDraft = pr.metadata?.draft === true;

    if (isMerged) {
      return {
        icon: <GitMerge className="h-3 w-3 text-info-foreground" />,
        status: t("tasks:pr.merged"),
        statusClass: "text-info-foreground",
      };
    }

    if (isDraft) {
      return {
        icon: <GitPullRequest className="h-3 w-3 text-muted-foreground" />,
        status: t("tasks:pr.draft"),
        statusClass: "text-muted-foreground",
      };
    }

    return {
      icon: <GitPullRequest className="h-3 w-3 text-success-foreground" />,
      status: t("tasks:pr.open"),
      statusClass: "text-success-foreground",
    };
  };

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition:
      transition || "transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    opacity: isDragging ? 0.6 : 1,
    touchAction: isDragging ? "none" : "auto",
    zIndex: isDragging ? 999 : "auto",
  };

  const assignee = useMemo(() => {
    return task.userId ? workspaceUsersById.get(task.userId) : undefined;
  }, [workspaceUsersById, task.userId]);
  const dueDate = showDueDates && task.dueDate ? new Date(task.dueDate) : null;
  const dueDateStatus = dueDate
    ? getDueDateStatus(dueDate, taskIsCompleted)
    : null;

  function handleTaskCardClick(
    e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (!workspaceId) return;

    if ((e as React.MouseEvent).metaKey || (e as React.KeyboardEvent).ctrlKey) {
      toggleSelection(task.id);
      return;
    }

    onOpenTask(task.id);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      toggleSelection(task.id);
    }
  };

  return (
    <div data-task-id={task.id} ref={setNodeRef} style={style} {...listeners}>
      {/** biome-ignore lint/a11y/noStaticElementInteractions: false positive for onClick and onKeyDown */}
      <div
        onClick={handleTaskCardClick}
        className={`group relative rounded-lg border bg-background p-3 shadow-xs/5 transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.98] ${
          disableDragDrop ? "cursor-default" : "cursor-move"
        } ${
          isDragging
            ? "border-ring/40 data-[task-dragging=true]:bg-card shadow-lg"
            : "hover:border-border/90 hover:bg-background hover:shadow-sm"
        } ${
          isTaskSelected
            ? "border-ring/40 data-[task-selected=true]:not-data-[task-dragging=true]:bg-accent/50 shadow-sm ring-1 ring-inset ring-ring/30"
            : "border-border"
        } ${isTaskFocused ? "ring-2 ring-inset ring-ring/50" : ""}`}
        data-task-dragging={isDragging ? "true" : undefined}
        data-task-selected={isTaskSelected ? "true" : undefined}
        {...attributes}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleTaskCardClick(e);
          } else if (e.key === "Escape") {
            handleKeyDown(e);
          } else if (
            e.key === "ContextMenu" ||
            (e.shiftKey && e.key === "F10")
          ) {
            e.preventDefault();
            onContextMenuTask(task.id);
          }
        }}
      >
        {showTaskNumbers && (
          <div className="mb-2 text-[10px] font-mono text-muted-foreground">
            {projectSlug}-{task.number}
          </div>
        )}

        {showAssignees && (
          <div className="absolute top-3 right-3">
            {task.userId ? (
              <Avatar className="h-5 w-5">
                <AvatarImage
                  src={assignee?.user?.image ?? ""}
                  alt={assignee?.user?.name || ""}
                />
                <AvatarFallback className="text-xs font-medium border border-border/30">
                  {getInitials(assignee?.user?.name)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div
                className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted"
                title={t("tasks:assignee.unassigned")}
              >
                <span className="text-[10px] font-medium text-muted-foreground">
                  ?
                </span>
              </div>
            )}
          </div>
        )}

        <div className="mb-2.5 pr-6">
          <div
            className="overflow-hidden break-words leading-5 font-medium text-foreground text-[15px]"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              wordBreak: "break-word",
              hyphens: "auto",
            }}
          >
            {task.title}
          </div>
        </div>

        {showLabels && (
          <div className="mb-2.5">
            <TaskLabels labels={task.labels ?? []} />
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {showPriority && (
            <span className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground h-5.5">
              {getPriorityIcon(task.priority ?? "")}
            </span>
          )}

          {taskItemStats && taskItemStats.total > 0 && (
            <span
              className={cn(
                "flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-muted/50 text-muted-foreground h-5.5",
                {
                  "bg-success/10 text-success-foreground":
                    taskItemStats.completed === taskItemStats.total,
                },
              )}
            >
              <SquareCheck className="h-[12px] w-[12px]" />
              {taskItemStats.completed}/{taskItemStats.total}
            </span>
          )}

          {dueDateStatus && dueDate && (
            <div
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded h-5.5 ${dueDateStatusColors[dueDateStatus]}`}
            >
              {dueDateStatus === "overdue" && <CalendarX className="w-3 h-3" />}
              {dueDateStatus === "due-soon" && (
                <CalendarClock className="w-3 h-3" />
              )}
              {(dueDateStatus === "far-future" ||
                dueDateStatus === "no-due-date") && (
                <Calendar className="w-3 h-3" />
              )}
              <span>{format(dueDate, "MMM d")}</span>
            </div>
          )}

          {pullRequests.length === 1 && (
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(pullRequests[0].url, "_blank");
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                >
                  {getPRInfo(pullRequests[0]).icon}
                  <span>#{pullRequests[0].externalId}</span>
                </button>
              </HoverCardTrigger>
              <HoverCardContent
                className="w-72 p-3"
                side="bottom"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {getPRInfo(pullRequests[0]).icon}
                    <span>{getPRInfo(pullRequests[0]).status}</span>
                    <span className="text-muted-foreground">•</span>
                    <span>#{pullRequests[0].externalId}</span>
                  </div>
                  <p className="text-sm font-medium leading-snug">
                    {pullRequests[0].title || t("tasks:pr.label")}
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          )}

          {pullRequests.length > 1 &&
            (() => {
              const hasOpen = pullRequests.some(
                (pr) => !pr.metadata?.merged && !pr.metadata?.draft,
              );
              const allMerged = pullRequests.every((pr) => pr.metadata?.merged);
              const iconColor = allMerged
                ? "text-info-foreground"
                : hasOpen
                  ? "text-success-foreground"
                  : "text-muted-foreground";

              return (
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                    >
                      <GitPullRequest className={`h-3 w-3 ${iconColor}`} />
                      <span>
                        {t("tasks:pr.count", {
                          count: pullRequests.length,
                        })}
                      </span>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent
                    className="w-auto min-w-56 max-w-96 p-1"
                    side="bottom"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {pullRequests.map((pr, index) => {
                      const prInfo = getPRInfo(pr);
                      const repoMatch = pr.url.match(
                        /github\.com\/([^/]+\/[^/]+)\/pull/,
                      );
                      const repoName = repoMatch ? repoMatch[1] : null;
                      return (
                        <div key={pr.id}>
                          {index > 0 && <hr className="border-border my-1" />}
                          <button
                            type="button"
                            onClick={() => window.open(pr.url, "_blank")}
                            className="w-full px-2 py-1.5 text-left hover:bg-muted/50 rounded transition-colors"
                          >
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              {prInfo.icon}
                              <span>
                                {repoName}#{pr.externalId}
                              </span>
                            </div>
                            <p className="text-xs leading-tight line-clamp-2 mt-0.5">
                              {pr.title || t("tasks:pr.label")}
                            </p>
                            <span className="text-[10px] text-muted-foreground">
                              {prInfo.status}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </HoverCardContent>
                </HoverCard>
              );
            })()}
        </div>
      </div>
    </div>
  );
}

export function TaskCardDeleteConfirmation({
  taskId,
  onOpenChange,
}: {
  taskId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { mutateAsync: deleteTask } = useDeleteTask();

  const handleDeleteTask = async () => {
    try {
      await deleteTask(taskId);
      toast.success(t("tasks:delete.success"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tasks:delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks:delete.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <AlertDialogClose
            render={
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteTask}
              />
            }
          >
            {t("tasks:delete.action")}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default memo(TaskCard);
