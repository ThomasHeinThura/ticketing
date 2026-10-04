import { Button } from "@taskdesk/ui";
import { Calendar, CalendarClock, CalendarDays, CalendarX } from "lucide-react";
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

type TaskPropertiesControlsProps = {
  task: Task | undefined;
  columns: ColumnData;
  workspaceUsers: WorkspaceUsersData;
  workspaceId: string;
  compact: boolean;
};

export default function TaskPropertiesControls({
  task,
  columns,
  workspaceUsers,
  workspaceId,
  compact,
}: TaskPropertiesControlsProps) {
  const { t } = useTranslation();

  if (!task) return null;

  const taskIsCompleted = isTaskCompleted(task.status ?? "", columns);
  const statusColumn = columns.find(
    (column) => column.slug === task.status || column.id === task.status,
  );
  const statusLabel = getStatusDisplayLabel(
    task.status ?? "",
    statusColumn?.name,
  );
  const assignee = workspaceUsers?.members?.find(
    (member) => member.userId === task.userId,
  );
  const buttonClassName = cn(
    "justify-start h-7 px-1.5 gap-1.5",
    !compact && "lg:w-full",
  );

  return (
    <div
      className={cn(
        "flex flex-row flex-wrap gap-1 items-center p-2 w-full",
        !compact && "lg:flex-col lg:items-stretch lg:gap-2 lg:px-3 lg:py-3",
      )}
    >
      <TaskStatusPopover task={task}>
        <Button variant="ghost" size="sm" className={buttonClassName}>
          {getColumnIcon(
            task.status ?? "",
            statusColumn?.isFinal,
            statusColumn?.icon,
          )}
          <span className="text-xs font-semibold truncate">{statusLabel}</span>
        </Button>
      </TaskStatusPopover>
      <TaskPriorityPopover task={task}>
        <Button variant="ghost" size="sm" className={buttonClassName}>
          {getPriorityIcon(task.priority ?? "")}
          <span className="text-xs font-semibold truncate">
            {getPriorityLabel(task.priority ?? "")}
          </span>
        </Button>
      </TaskPriorityPopover>
      <TaskAssigneePopover task={task} workspaceId={workspaceId}>
        <Button variant="ghost" size="sm" className={buttonClassName}>
          {task.userId ? (
            <Avatar className="h-[16px] w-[16px]">
              <AvatarImage
                src={assignee?.user?.image ?? ""}
                alt={assignee?.user?.name || ""}
              />
              <AvatarFallback className="text-[9px] font-medium border border-border/30 shrink-0 h-[16px] w-[16px]">
                {getInitials(assignee?.user?.name || task.assigneeName)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div
              className="w-[16px] h-[16px] rounded-full bg-muted border border-border flex items-center justify-center shrink-0"
              title={t("tasks:popover.assignee.unassigned")}
            >
              <span className="text-[8px] font-medium">?</span>
            </div>
          )}
          <span className="text-xs font-semibold truncate max-w-[100px]">
            {assignee?.user?.name ||
              task.assigneeName ||
              t("tasks:popover.assignee.unassigned")}
          </span>
        </Button>
      </TaskAssigneePopover>
      <TaskStartDatePopover task={task}>
        <Button variant="ghost" size="sm" className={buttonClassName}>
          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          <span
            className={`text-xs font-semibold ${task.startDate ? "" : "text-muted-foreground"}`}
          >
            {task.startDate
              ? formatDateShort(task.startDate)
              : t(
                  compact
                    ? "tasks:properties.start"
                    : "tasks:properties.startDate",
                )}
          </span>
        </Button>
      </TaskStartDatePopover>
      <TaskDueDatePopover task={task}>
        <Button variant="ghost" size="sm" className={buttonClassName}>
          {task.dueDate ? (
            <>
              {getDueDateStatus(task.dueDate, taskIsCompleted) ===
                "overdue" && (
                <CalendarX
                  className={`w-3.5 h-3.5 ${dueDateStatusColors[getDueDateStatus(task.dueDate, taskIsCompleted)]}`}
                />
              )}
              {getDueDateStatus(task.dueDate, taskIsCompleted) ===
                "due-soon" && (
                <CalendarClock
                  className={`w-3.5 h-3.5 ${dueDateStatusColors[getDueDateStatus(task.dueDate, taskIsCompleted)]}`}
                />
              )}
              {(getDueDateStatus(task.dueDate, taskIsCompleted) ===
                "far-future" ||
                getDueDateStatus(task.dueDate, taskIsCompleted) ===
                  "no-due-date") && (
                <Calendar
                  className={`w-3.5 h-3.5 ${dueDateStatusColors[getDueDateStatus(task.dueDate, taskIsCompleted)]}`}
                />
              )}
              <span className="text-xs font-semibold">
                {formatDateShort(task.dueDate)}
              </span>
            </>
          ) : (
            <>
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">
                {t("tasks:properties.noDate")}
              </span>
            </>
          )}
        </Button>
      </TaskDueDatePopover>
    </div>
  );
}
