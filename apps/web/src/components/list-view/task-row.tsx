import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@taskdesk/ui";
import { format } from "date-fns";
import type { TFunction } from "i18next";
import {
  Calendar,
  CalendarClock,
  CalendarX,
  GitMerge,
  GitPullRequest,
} from "lucide-react";
import type { CSSProperties } from "react";
import { memo, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { getInitials } from "@/lib/get-initials";
import { getPriorityIcon } from "@/lib/priority";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import type { TaskCardWorkspaceUser } from "../kanban-board/task-card";
import { TaskLabels } from "../kanban-board/task-labels";

type TaskRowProps = {
  task: Task;
  projectSlug: string;
  taskIsCompleted: boolean;
  assignee?: TaskCardWorkspaceUser;
  displayPreferences: {
    showAssignees: boolean;
    showPriority: boolean;
    showDueDates: boolean;
    showLabels: boolean;
    showTaskNumbers: boolean;
  };
  onOpenTask: (taskId: string) => void;
  t: TFunction;
};

function TaskRow({
  task,
  projectSlug,
  taskIsCompleted,
  assignee,
  displayPreferences,
  onOpenTask,
  t,
}: TaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const toggleSelection = useBulkSelectionStore(
    (state) => state.toggleSelection,
  );
  const selected = useBulkSelectionStore((state) =>
    state.selectedTaskIds.has(task.id),
  );
  const focused = useBulkSelectionStore(
    (state) => state.focusedTaskId === task.id,
  );
  const {
    showAssignees,
    showPriority,
    showDueDates,
    showLabels,
    showTaskNumbers,
  } = displayPreferences;

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
    transition: transition || "transform 200ms cubic-bezier(0.23, 1, 0.32, 1)",
    touchAction: isDragging ? "none" : "auto",
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!task) return;
    if (e.defaultPrevented) return;

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelection(task.id);
      return;
    }

    const currentParams = new URLSearchParams(window.location.search);
    const currentTaskId = currentParams.get("taskId");

    onOpenTask(currentTaskId === task.id ? "" : task.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleClick(e as unknown as React.MouseEvent);
    }
  };

  return (
    <div
      data-task-id={task.id}
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-border/50 transition-colors duration-150",
        isDragging && "opacity-50",
        selected && "bg-accent/60 shadow-sm ring-1 ring-inset ring-ring/30",
        focused && "ring-2 ring-inset ring-ring/50",
      )}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: false positive for onClick and onKeyDown */}
      <div
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "group relative flex items-center gap-3 px-4 py-1.5 transition-colors cursor-pointer",
          selected ? "bg-accent/45" : "hover:bg-accent/60",
        )}
        {...attributes}
        {...listeners}
      >
        {showPriority && (
          <div className="flex-shrink-0 first:[&_svg]:h-4 first:[&_svg]:w-4">
            {getPriorityIcon(task.priority ?? "")}
          </div>
        )}
        {showTaskNumbers && (
          <div className="text-xs font-mono text-muted-foreground flex-shrink-0">
            {projectSlug}-{task.number}
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <div className="flex items-center gap-2 justify-between w-full">
            <span className="text-sm text-foreground truncate">
              {task.title}
            </span>
            <div className="flex items-center gap-1">
              {showLabels && <TaskLabels labels={task.labels ?? []} />}

              {pullRequests.length === 1 && (
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(pullRequests[0].url, "_blank");
                      }}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-sidebar text-[10px] font-medium text-muted-foreground"
                    >
                      {getPRInfo(pullRequests[0]).icon}
                      <span>#{pullRequests[0].externalId}</span>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent
                    className="w-72 p-3"
                    side="bottom"
                    onClick={(e) => e.stopPropagation()}
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
                  const allMerged = pullRequests.every(
                    (pr) => pr.metadata?.merged,
                  );
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
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-sidebar text-[10px] font-medium text-muted-foreground"
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
                      >
                        {pullRequests.map((pr, index) => {
                          const prInfo = getPRInfo(pr);
                          const repoMatch = pr.url.match(
                            /github\.com\/([^/]+\/[^/]+)\/pull/,
                          );
                          const repoName = repoMatch ? repoMatch[1] : null;
                          return (
                            <div key={pr.id}>
                              {index > 0 && (
                                <hr className="border-border my-1" />
                              )}
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

        {showDueDates && task.dueDate && (
          <div
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded flex-shrink-0 ${dueDateStatusColors[getDueDateStatus(task.dueDate, taskIsCompleted)]}`}
          >
            {getDueDateStatus(task.dueDate, taskIsCompleted) === "overdue" && (
              <CalendarX className="w-3 h-3" />
            )}
            {getDueDateStatus(task.dueDate, taskIsCompleted) === "due-soon" && (
              <CalendarClock className="w-3 h-3" />
            )}
            {(getDueDateStatus(task.dueDate, taskIsCompleted) ===
              "far-future" ||
              getDueDateStatus(task.dueDate, taskIsCompleted) ===
                "no-due-date") && <Calendar className="w-3 h-3" />}
            <span>{format(new Date(task.dueDate), "MMM d")}</span>
          </div>
        )}

        {showAssignees && (
          <div className="flex-shrink-0">
            {task.userId ? (
              <Avatar className="h-6 w-6">
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
                className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"
                title={t("tasks:assignee.unassigned")}
              >
                <span className="text-[10px] font-medium text-muted-foreground">
                  ?
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TaskRow);
