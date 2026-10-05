import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ShortcutNumber,
} from "@taskdesk/ui";
import { Check } from "lucide-react";
import type { RefObject } from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateTaskStatus } from "@/hooks/mutations/task/use-update-task-status";
import type { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { getStatusDisplayLabel } from "@/lib/i18n/domain";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskStatusPopoverProps = {
  task: Task;
  columns: NonNullable<ReturnType<typeof useGetColumns>["data"]>;
  isLoading: boolean;
  isError: boolean;
  taskRef?: RefObject<Task | undefined>;
  children: React.ReactNode;
};

type StatusOption = {
  value: string;
  label: string;
  icon: string | null;
  isFinal: boolean;
};

const TaskStatusOption = memo(function TaskStatusOption({
  status,
  index,
  selected,
  onSelect,
}: {
  status: StatusOption;
  index: number;
  selected: boolean;
  onSelect: (status: string) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 h-8 px-2 rounded-none first:rounded-t-md last:rounded-b-md"
      onClick={() => onSelect(status.value)}
    >
      {getColumnIcon(status.value, status.isFinal, status.icon)}
      <span className="text-sm">
        {getStatusDisplayLabel(status.value, status.label)}
      </span>
      {selected ? (
        <Check className="ml-auto h-4 w-4" />
      ) : (
        <ShortcutNumber number={index + 1} />
      )}
    </Button>
  );
});

export default function TaskStatusPopover({
  task,
  columns,
  isLoading,
  isError,
  taskRef,
  children,
}: TaskStatusPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const latestTaskRef = useRef(task);
  latestTaskRef.current = task;
  const statusOptions = useMemo(
    () =>
      (columns ?? []).map((col) => ({
        value: col.slug,
        label: col.name,
        icon: col.icon,
        isFinal: col.isFinal,
      })),
    [columns],
  );
  const { mutateAsync: updateTaskStatus } = useUpdateTaskStatus();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      setOpen(false);
      try {
        const currentTask = taskRef?.current ?? latestTaskRef.current;
        await updateTaskStatus({
          ...currentTask,
          status: newStatus,
        });
      } catch (error) {
        setOpen(true);
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.status.updateError"),
        );
      }
    },
    [t, taskRef, updateTaskStatus],
  );

  const shortcutOptions = useMemo(
    () =>
      statusOptions.map((status) => ({
        onSelect: () => handleStatusChange(status.value),
      })),
    [handleStatusChange, statusOptions],
  );

  useNumberedShortcuts(open, shortcutOptions);

  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <div>
          {isLoading ? (
            <div className="p-3 text-center text-sm text-muted-foreground">
              {t("common:empty.loading")}
            </div>
          ) : isError ? (
            <div className="p-3 text-center text-sm text-destructive">
              {t("common:error.title")}
            </div>
          ) : (
            statusOptions.map((status, index) => (
              <TaskStatusOption
                key={status.value}
                status={status}
                index={index}
                selected={task.status === status.value}
                onSelect={handleStatusChange}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
