import { Button } from "@taskdesk/ui";
import { Calendar, CalendarClock, CalendarDays, CalendarX } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import TaskAssigneePopover from "@/components/task/task-assignee-popover";
import TaskDueDatePopover from "@/components/task/task-due-date-popover";
import TaskPriorityPopover from "@/components/task/task-priority-popover";
import TaskStartDatePopover from "@/components/task/task-start-date-popover";
import TaskStatusPopover from "@/components/task/task-status-popover";
import type { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import type { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import {
  dueDateStatusColors,
  getDueDateStatus,
  isTaskCompleted,
} from "@/lib/due-date-status";
import { formatDateShort } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel, getStatusDisplayLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import type Task from "@/types/task";

type ColumnData = NonNullable<ReturnType<typeof useGetColumns>["data"]>;
type WorkspaceUsersData = ReturnType<typeof useGetActiveWorkspaceUsers>["data"];
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

type TaskPropertiesControlsProps = {
  task?: TaskPropertiesSummary;
  taskForMutation?: Task;
  columns: ColumnData;
  workspaceUsers: WorkspaceUsersData;
  compact: boolean;
  columnsLoading: boolean;
  columnsError: boolean;
};

const buttonClass = (compact: boolean) =>
  cn("justify-start h-7 px-1.5 gap-1.5", !compact && "lg:w-full");

export default function TaskPropertiesControls({
  task,
  taskForMutation,
  columns,
  workspaceUsers,
  compact,
  columnsLoading,
  columnsError,
}: TaskPropertiesControlsProps) {
  const {
    t,
    ready,
    i18n: { language },
  } = useTranslation(["common", "tasks"]);
  const translate = useCallback(
    (key: string) => (ready ? t(key, { lng: language }) : key),
    [t, ready, language],
  );
  const taskRef = useRef(taskForMutation);
  taskRef.current = taskForMutation;
  const taskId = task?.id;
  const status = task?.status;
  const priority = task?.priority;
  const userId = task?.userId;
  const assigneeName = task?.assigneeName;
  const startDate = task?.startDate;
  const dueDate = task?.dueDate;
  const statusControl = useMemo(() => {
    const latestTask = taskRef.current;
    if (!taskId || !latestTask) return null;
    const statusColumn = columns.find(
      (column) => column.slug === status || column.id === status,
    );
    const statusLabel = getStatusDisplayLabel(
      status ?? "",
      statusColumn?.name,
      language,
    );

    return (
      <TaskStatusPopover
        task={latestTask}
        taskRef={taskRef}
        columns={columns}
        isLoading={columnsLoading}
        isError={columnsError}
      >
        <Button variant="ghost" size="sm" className={buttonClass(compact)}>
          {getColumnIcon(
            status ?? "",
            statusColumn?.isFinal,
            statusColumn?.icon,
          )}
          <span className="text-xs font-semibold truncate">{statusLabel}</span>
        </Button>
      </TaskStatusPopover>
    );
  }, [
    taskId,
    status,
    columns,
    columnsLoading,
    columnsError,
    compact,
    language,
  ]);

  const priorityControl = useMemo(() => {
    const latestTask = taskRef.current;
    if (!taskId || !latestTask) return null;
    return (
      <TaskPriorityPopover task={latestTask} taskRef={taskRef}>
        <Button variant="ghost" size="sm" className={buttonClass(compact)}>
          {getPriorityIcon(priority ?? "")}
          <span className="text-xs font-semibold truncate">
            {getPriorityLabel(priority ?? "", language)}
          </span>
        </Button>
      </TaskPriorityPopover>
    );
  }, [taskId, priority, compact, language]);

  const assigneeControl = useMemo(() => {
    const latestTask = taskRef.current;
    if (!taskId || !latestTask) return null;
    const assignee = workspaceUsers?.members?.find(
      (member) => member.userId === userId,
    );

    return (
      <TaskAssigneePopover
        task={latestTask}
        taskRef={taskRef}
        workspaceUsers={workspaceUsers}
      >
        <Button variant="ghost" size="sm" className={buttonClass(compact)}>
          {userId ? (
            <Avatar className="h-[16px] w-[16px]">
              <AvatarImage
                src={assignee?.user?.image ?? ""}
                alt={assignee?.user?.name ?? assigneeName ?? ""}
              />
              <AvatarFallback className="text-[8px]">
                {getInitials(assignee?.user?.name ?? assigneeName ?? "")}
              </AvatarFallback>
            </Avatar>
          ) : null}
          <span
            className={`text-xs font-semibold truncate ${userId ? "" : "text-muted-foreground"}`}
          >
            {assignee?.user?.name ??
              assigneeName ??
              translate("tasks:popover.assignee.unassigned")}
          </span>
        </Button>
      </TaskAssigneePopover>
    );
  }, [taskId, userId, assigneeName, workspaceUsers, compact, translate]);

  const startDateControl = useMemo(() => {
    const latestTask = taskRef.current;
    if (!taskId || !latestTask) return null;
    return (
      <TaskStartDatePopover task={latestTask} taskRef={taskRef}>
        <Button variant="ghost" size="sm" className={buttonClass(compact)}>
          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          <span
            className={`text-xs font-semibold ${startDate ? "" : "text-muted-foreground"}`}
          >
            {startDate
              ? formatDateShort(startDate)
              : translate("tasks:properties.noDate")}
          </span>
        </Button>
      </TaskStartDatePopover>
    );
  }, [taskId, startDate, compact, translate]);

  const dueDateControl = useMemo(() => {
    const latestTask = taskRef.current;
    if (!taskId || !latestTask) return null;
    const completed = isTaskCompleted(status ?? "", columns);
    const dueDateStatus = dueDate
      ? getDueDateStatus(dueDate, completed)
      : undefined;

    return (
      <TaskDueDatePopover
        task={{ ...latestTask, startDate: startDate ?? null }}
        taskRef={taskRef}
      >
        <Button variant="ghost" size="sm" className={buttonClass(compact)}>
          {!dueDate && (
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          {dueDateStatus === "overdue" && (
            <CalendarX
              className={`w-3.5 h-3.5 ${dueDateStatusColors[dueDateStatus]}`}
            />
          )}
          {dueDateStatus === "due-soon" && (
            <CalendarClock
              className={`w-3.5 h-3.5 ${dueDateStatusColors[dueDateStatus]}`}
            />
          )}
          {(dueDateStatus === "far-future" ||
            dueDateStatus === "no-due-date") && (
            <Calendar
              className={`w-3.5 h-3.5 ${dueDateStatusColors[dueDateStatus]}`}
            />
          )}
          <span
            className={cn(
              "text-xs font-semibold",
              !dueDate && "text-muted-foreground",
            )}
          >
            {dueDate
              ? formatDateShort(dueDate)
              : translate("tasks:properties.noDate")}
          </span>
        </Button>
      </TaskDueDatePopover>
    );
  }, [taskId, dueDate, status, columns, compact, startDate, translate]);

  if (!task || !taskForMutation) return null;

  return (
    <div
      className={cn(
        "flex flex-row flex-wrap gap-1 items-center p-2 w-full",
        !compact && "lg:flex-col lg:items-stretch lg:gap-2 lg:px-3 lg:py-3",
      )}
    >
      {statusControl}
      {priorityControl}
      {assigneeControl}
      {startDateControl}
      {dueDateControl}
    </div>
  );
}
