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
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { memo, useId, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { getInitials } from "@/lib/get-initials";
import { getPriorityIcon } from "@/lib/priority";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import type { TaskCardWorkspaceUser } from "../kanban-board/task-card";
import {
  deferKeyboardSensorKey,
  isDeferredKeyboardSensorEvent,
} from "../kanban-board/task-card-keyboard-sensor";
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
  taskHref?: string;
  /** Route-owned sheet opening while modifier clicks retain the real href. */
  openTaskOnLinkClick?: boolean;
  disableDragDrop?: boolean;
  selectionEnabled?: boolean;
  isSelected?: boolean;
  onToggleSelection?: () => void;
  /** Extra row badges (`VW-16`'s SLA badge), shown beside the labels. */
  badges?: ReactNode;
  /** Canonical work-item inline controls. Legacy TaskRow callers keep their original display. */
  stateControl?: ReactNode;
  priorityControl?: ReactNode;
  assigneeControl?: ReactNode;
};

function TaskRow({
  task,
  projectSlug,
  taskIsCompleted,
  assignee,
  displayPreferences,
  onOpenTask,
  taskHref,
  openTaskOnLinkClick = false,
  disableDragDrop = false,
  selectionEnabled = true,
  isSelected,
  onToggleSelection,
  badges,
  stateControl,
  priorityControl,
  assigneeControl,
  t,
}: TaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: disableDragDrop });
  const {
    role: _sortableRole,
    "aria-pressed": _sortablePressed,
    "aria-describedby": sortableDescription,
    ...sortableAttributes
  } = attributes;
  const rowAttributes = disableDragDrop ? { tabIndex: 0 } : sortableAttributes;
  const { onKeyDown: onSortableKeyDown, ...sortableListeners } = disableDragDrop
    ? {}
    : (listeners ?? {});
  const keyboardHintId = useId();
  const describedBy = [
    disableDragDrop ? undefined : sortableDescription,
    keyboardHintId,
  ]
    .filter(Boolean)
    .join(" ");

  const {
    toggleSelection,
    selected: storeSelected,
    focused,
  } = useBulkSelectionStore(
    useShallow((state) => ({
      toggleSelection: state.toggleSelection,
      selected: state.selectedTaskIds.has(task.id),
      focused: state.focusedTaskId === task.id,
    })),
  );
  const selected = isSelected ?? storeSelected;
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
    if (isOutsideRowControlTarget(e)) return;

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      if (selectionEnabled) {
        if (onToggleSelection) onToggleSelection();
        else toggleSelection(task.id);
      }
      return;
    }

    const currentParams = new URLSearchParams(window.location.search);
    const currentTaskId = currentParams.get("taskId");

    onOpenTask(currentTaskId === task.id ? "" : task.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    // Native anchors and controls own their keyboard activation.
    if (e.target !== e.currentTarget) return;
    if (isDeferredKeyboardSensorEvent(e.nativeEvent)) return;
    if (e.key === "Enter" && !isDragging) {
      handleClick(e as unknown as React.MouseEvent);
    } else if (disableDragDrop && e.key === " ") {
      handleClick(e as unknown as React.MouseEvent);
      e.preventDefault();
    } else if (
      isDragging &&
      [
        "Space",
        "Enter",
        "Escape",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.code)
    ) {
      deferKeyboardSensorKey(e.currentTarget, e.nativeEvent);
    }
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isDeferredKeyboardSensorEvent(e.nativeEvent)) return;
    onSortableKeyDown?.(e);
    handleKeyDown(e);
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
      <Fieldset
        onClick={handleClick}
        className={cn(
          "group relative m-0 flex w-full min-w-0 max-w-none flex-row items-center gap-3 border-0 p-0 px-4 py-1.5 transition-colors cursor-pointer",
          selected ? "bg-accent/45" : "hover:bg-accent/60",
        )}
        {...rowAttributes}
        {...sortableListeners}
        onMouseDown={(event) => {
          if (!isOutsideRowControlTarget(event))
            sortableListeners.onMouseDown?.(event);
        }}
        onTouchStart={(event) => {
          if (!isOutsideRowControlTarget(event))
            sortableListeners.onTouchStart?.(event);
        }}
        onPointerDown={(event) => {
          if (!isOutsideRowControlTarget(event))
            sortableListeners.onPointerDown?.(event);
        }}
        tabIndex={0}
        aria-describedby={describedBy}
        data-task-dragging={isDragging ? "true" : undefined}
        onKeyDown={handleRowKeyDown}
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
        {showPriority &&
          (priorityControl ? (
            <InlineControlSlot>{priorityControl}</InlineControlSlot>
          ) : (
            <div className="flex-shrink-0 first:[&_svg]:h-4 first:[&_svg]:w-4">
              {getPriorityIcon(task.priority ?? "")}
            </div>
          ))}
        {showTaskNumbers && (
          <div className="text-xs font-mono text-muted-foreground flex-shrink-0">
            {projectSlug}-{task.number}
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-2">
          {/* Narrow rows (375 px phones) wrap the chips under the title instead of letting them
              paint over the due-date chip and squeeze the title to one letter. */}
          <div
            data-task-row-main="true"
            className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1"
          >
            {stateControl ? (
              <InlineControlSlot>{stateControl}</InlineControlSlot>
            ) : null}
            <span
              data-task-row-title="true"
              className="min-w-24 flex-1 basis-24 truncate text-left text-sm text-foreground"
            >
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
            </span>
            <div
              data-task-row-chips="true"
              className="flex min-w-0 max-w-full flex-wrap items-center gap-1"
            >
              {showLabels && <TaskLabels labels={task.labels ?? []} />}
              {badges}

              {pullRequests.length === 1 && (
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(pullRequests[0].url, "_blank");
                      }}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-sidebar text-[10px] font-medium text-muted-foreground"
                    >
                      {getPRInfo(pullRequests[0]).icon}
                      <span>#{pullRequests[0].externalId}</span>
                    </Button>
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
                        <Button
                          variant="ghost"
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
                        </Button>
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

        {showAssignees &&
          (assigneeControl ? (
            <InlineControlSlot>{assigneeControl}</InlineControlSlot>
          ) : (
            <div className="flex-shrink-0">
              {task.userId || task.assigneeId ? (
                <Avatar className="h-6 w-6">
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
                  className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"
                  title={t("tasks:assignee.unassigned")}
                >
                  <span className="text-[10px] font-medium text-muted-foreground">
                    ?
                  </span>
                </div>
              )}
            </div>
          ))}
      </Fieldset>
    </div>
  );
}

function InlineControlSlot({ children }: { children: ReactNode }) {
  return <div data-task-row-inline-control="true">{children}</div>;
}

function isInlineControlTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-task-row-inline-control]"))
  );
}

/**
 * True for an event the row must ignore: one from an inline control slot, or one React bubbled
 * up from portalled content (an inline picker's popover options live outside the row's DOM but
 * still bubble through the React tree), so choosing an option never opens the item or starts a
 * drag.
 */
function isOutsideRowControlTarget(event: {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}) {
  if (isInlineControlTarget(event.target)) return true;
  const { target, currentTarget } = event;
  return (
    target instanceof Node &&
    currentTarget instanceof Node &&
    !currentTarget.contains(target)
  );
}

export default memo(TaskRow);
