import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  Fieldset,
  FieldsetLegend,
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
import { type CSSProperties, memo, type ReactNode, useId } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import type { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { getInitials } from "@/lib/get-initials";
import { getTaskItemStats } from "@/lib/get-task-item-stats";
import { getPriorityIcon } from "@/lib/priority";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import { TaskLabels } from "./task-labels";

export type TaskCardWorkspaceUser = NonNullable<
  NonNullable<ReturnType<typeof useGetActiveWorkspaceUsers>["data"]>["members"]
>[number];

export type TaskCardProps = {
  task: Task;
  /** DnD-only id when one task card appears in more than one board group. */
  sortableId?: string;
  disableDragDrop?: boolean;
  workspaceId?: string;
  assignee?: TaskCardWorkspaceUser;
  onContextMenuTask: (taskId: string) => void;
  projectSlug: string;
  taskIsCompleted: boolean;
  displayPreferences: TaskCardDisplayPreferences;
  isSelected: boolean;
  isFocused: boolean;
  onOpenTask: (taskId: string) => void;
  t: TFunction;
  taskHref?: string;
  /** Route-owned sheet opening while modifier clicks retain the real href. */
  openTaskOnLinkClick?: boolean;
  selectionEnabled?: boolean;
  onToggleSelection?: () => void;
  /** Extra metadata-row badges (`SLA-18`'s compact SLA badge). */
  badges?: ReactNode;
};

export type TaskCardDisplayPreferences = {
  showAssignees: boolean;
  showPriority: boolean;
  showDueDates: boolean;
  showLabels: boolean;
  showTaskNumbers: boolean;
  showTaskItemCounts: boolean;
};

const EMPTY_TASK_ITEM_STATS = { total: 0, completed: 0 };
const EMPTY_PULL_REQUESTS: NonNullable<Task["externalLinks"]> = [];
const DEFAULT_DRAG_TRANSITION =
  "transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)";

const deferredKeyboardSensorEvents = new WeakSet<KeyboardEvent>();

export function isDeferredKeyboardSensorEvent(event: KeyboardEvent): boolean {
  return deferredKeyboardSensorEvents.has(event);
}

/**
 * dnd-kit attaches KeyboardSensor's document listener on the task after Space
 * activates it. Replay an unhandled movement/end/cancel key only while this
 * same card remains connected and marked active; handled, stale, and replayed
 * events are ignored.
 */
export function deferKeyboardSensorKey(
  card: HTMLElement,
  event: KeyboardEvent,
): void {
  if (
    isDeferredKeyboardSensorEvent(event) ||
    ![
      "Space",
      "Enter",
      "Escape",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(event.code)
  )
    return;

  window.setTimeout(() => {
    if (
      event.defaultPrevented ||
      !card.isConnected ||
      card.dataset.taskDragging !== "true"
    )
      return;

    const deferredEvent = new KeyboardEvent("keydown", {
      key: event.key,
      code: event.code,
      bubbles: true,
      cancelable: true,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
    });
    deferredKeyboardSensorEvents.add(deferredEvent);
    card.dispatchEvent(deferredEvent);
  });
}

/** @deprecated Use deferKeyboardSensorKey; retained for existing callers/tests. */
export function deferKeyboardSensorEndKey(
  card: HTMLElement,
  event: KeyboardEvent,
): void {
  deferKeyboardSensorKey(card, event);
}

function TaskCard({
  task,
  sortableId,
  disableDragDrop = false,
  workspaceId,
  assignee,
  onContextMenuTask,
  projectSlug,
  taskIsCompleted,
  displayPreferences,
  isSelected,
  isFocused,
  onOpenTask,
  taskHref,
  openTaskOnLinkClick = false,
  selectionEnabled = true,
  onToggleSelection,
  badges,
  t,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId ?? task.id, disabled: disableDragDrop });
  // Sortable's disabled attributes describe a disabled drag activator, not a disabled task.
  const dragListeners = disableDragDrop ? undefined : listeners;
  const {
    role: _sortableRole,
    "aria-pressed": _sortablePressed,
    "aria-describedby": sortableDescription,
    ...sortableAttributes
  } = attributes;
  const cardAttributes = disableDragDrop ? { tabIndex: 0 } : sortableAttributes;
  const keyboardHintId = useId();
  const describedBy = [
    disableDragDrop ? undefined : sortableDescription,
    keyboardHintId,
  ]
    .filter(Boolean)
    .join(" ");
  const {
    showAssignees,
    showPriority,
    showDueDates,
    showLabels,
    showTaskNumbers,
  } = displayPreferences;
  const taskItemStats = !displayPreferences.showTaskItemCounts
    ? null
    : task.taskItemStats !== undefined
      ? task.taskItemStats
      : task.description
        ? getTaskItemStats(task.description)
        : EMPTY_TASK_ITEM_STATS;
  const pullRequests = task.externalLinks?.length
    ? task.externalLinks.filter((link) => link.resourceType === "pull_request")
    : EMPTY_PULL_REQUESTS;

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

  const style: CSSProperties | undefined =
    transform || isDragging
      ? {
          transform: CSS.Transform.toString(transform),
          transition: transition || DEFAULT_DRAG_TRANSITION,
          opacity: isDragging ? 0.6 : 1,
          touchAction: isDragging ? "none" : "auto",
          zIndex: isDragging ? 999 : "auto",
        }
      : undefined;

  const dueDate = showDueDates && task.dueDate ? new Date(task.dueDate) : null;
  const dueDateStatus = dueDate
    ? getDueDateStatus(dueDate, taskIsCompleted)
    : null;
  const hasMetadataRow =
    showPriority ||
    Boolean(taskItemStats?.total) ||
    Boolean(dueDateStatus) ||
    Boolean(badges) ||
    pullRequests.length > 0;

  function handleTaskCardClick(
    e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
  ) {
    if (!workspaceId && !taskHref) return;

    if ((e as React.MouseEvent).metaKey || (e as React.KeyboardEvent).ctrlKey) {
      if (selectionEnabled) {
        if (onToggleSelection) onToggleSelection();
        else useBulkSelectionStore.getState().toggleSelection(task.id);
      }
      return;
    }

    onOpenTask(task.id);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (selectionEnabled) {
        if (onToggleSelection) onToggleSelection();
        else useBulkSelectionStore.getState().toggleSelection(task.id);
      }
    }
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    // Native links/actions inside the card keep their own keyboard activation.
    if (e.target !== e.currentTarget) return;
    if (isDeferredKeyboardSensorEvent(e.nativeEvent)) return;
    dragListeners?.onKeyDown?.(e);
    if (e.key === "Enter") {
      // Enter opens an idle card. While dnd-kit owns an active keyboard drag,
      // its sensor uses Enter to drop the card.
      if (!isDragging) {
        handleTaskCardClick(e);
      } else {
        deferKeyboardSensorEndKey(e.currentTarget, e.nativeEvent);
      }
    } else if (e.key === "Escape") {
      if (!isDragging) {
        handleKeyDown(e);
      } else {
        deferKeyboardSensorEndKey(e.currentTarget, e.nativeEvent);
      }
    } else if (e.code === "Space" && isDragging) {
      deferKeyboardSensorEndKey(e.currentTarget, e.nativeEvent);
    } else if (
      isDragging &&
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)
    ) {
      deferKeyboardSensorKey(e.currentTarget, e.nativeEvent);
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      onContextMenuTask(task.id);
    } else if (disableDragDrop && e.key === " ") {
      e.preventDefault();
      handleTaskCardClick(e);
    }
  };

  return (
    <Fieldset
      data-task-id={task.id}
      ref={setNodeRef}
      style={style}
      {...dragListeners}
      onClick={handleTaskCardClick}
      className={`kanban-board-task-card group relative m-0 block w-full min-w-0 max-w-none gap-0 rounded-lg border bg-background p-3 shadow-xs/5 [contain:layout_style] transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.98] ${
        disableDragDrop ? "cursor-default" : "cursor-move"
      } ${
        isDragging
          ? "border-ring/40 data-[task-dragging=true]:bg-card shadow-lg"
          : "hover:border-border/90 hover:bg-background hover:shadow-sm"
      } ${
        isSelected
          ? "border-ring/40 data-[task-selected=true]:not-data-[task-dragging=true]:bg-accent/50 shadow-sm ring-1 ring-inset ring-ring/30"
          : "border-border"
      } ${isFocused ? "ring-2 ring-inset ring-ring/50" : ""}`}
      data-task-dragging={isDragging ? "true" : undefined}
      data-task-selected={isSelected ? "true" : undefined}
      {...cardAttributes}
      tabIndex={0}
      aria-describedby={describedBy}
      onKeyDown={handleCardKeyDown}
    >
      <FieldsetLegend className="sr-only">
        {t("common:a11y.taskContainerLabel", {
          key: `${projectSlug}-${task.number}`,
          title: task.title,
        })}
      </FieldsetLegend>
      <span id={keyboardHintId} className="sr-only">
        {t(
          disableDragDrop
            ? "common:a11y.taskOpenHint"
            : "common:a11y.taskOpenAndDragHint",
        )}
      </span>
      {showTaskNumbers && (
        <div className="mb-2 text-[10px] font-mono text-muted-foreground">
          {projectSlug}-{task.number}
        </div>
      )}

      {showAssignees && (
        <div className="absolute top-3 right-3">
          {task.userId || task.assigneeId ? (
            <Avatar className="h-5 w-5">
              <AvatarImage
                src={assignee?.user?.image ?? ""}
                alt={assignee?.user?.name ?? task.assigneeName ?? ""}
              />
              <AvatarFallback className="text-xs font-medium border border-border/30">
                {getInitials(assignee?.user?.name ?? task.assigneeName)}
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

      <div className="mb-2.5 pr-6 overflow-hidden break-words leading-5 font-medium text-foreground text-[15px] line-clamp-3 hyphens-auto">
        {taskHref ? (
          <a
            href={taskHref}
            aria-label={`${projectSlug}-${task.number} ${task.title}`}
            onClick={(event) => {
              event.stopPropagation();
              if (
                openTaskOnLinkClick &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                onOpenTask(task.id);
              }
            }}
          >
            {task.title}
          </a>
        ) : (
          task.title
        )}
      </div>

      {showLabels && task.labels && task.labels.length > 0 && (
        <div className="mb-2.5">
          <TaskLabels labels={task.labels} />
        </div>
      )}

      {hasMetadataRow && (
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

          {badges}

          {pullRequests.length === 1 && (
            <HoverCard openDelay={200} closeDelay={100}>
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label={`${getPRInfo(pullRequests[0]).status} pull request #${pullRequests[0].externalId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(pullRequests[0].url, "_blank");
                  }}
                  className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                >
                  {getPRInfo(pullRequests[0]).icon}
                  <span>#{pullRequests[0].externalId}</span>
                </Button>
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
                    <Button
                      variant="ghost"
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
                    </Button>
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
                          <Button
                            variant="ghost"
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
                          </Button>
                        </div>
                      );
                    })}
                  </HoverCardContent>
                </HoverCard>
              );
            })()}
        </div>
      )}
    </Fieldset>
  );
}

export default memo(TaskCard);
