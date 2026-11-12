import { ShortcutNumber, useDelayedPending } from "@taskdesk/ui";
import type { ReactElement, RefObject } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PropertyRadioMenu } from "@/components/work-item/property-radio-menu";
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
  children: ReactElement;
};

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
  const placeholderVisible = useDelayedPending(open && isLoading);
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

  useNumberedShortcuts(
    open && !isLoading && !placeholderVisible && !isError,
    shortcutOptions,
  );

  if (!canEdit) return <>{children}</>;

  // Kaneo's status picker on the library radio menu: arrow keys, typeahead and focus back to
  // the trigger, keeping the numbered shortcuts and the check on the current status.
  return (
    <PropertyRadioMenu
      open={open}
      onOpenChange={setOpen}
      value={task.status}
      onValueChange={(next) => {
        if (next !== task.status) void handleStatusChange(next);
        else setOpen(false);
      }}
      trigger={children}
      header={
        !isError && (isLoading || placeholderVisible) ? (
          <div
            className="p-3 text-center text-sm text-muted-foreground"
            style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
          >
            {t("common:empty.loading")}
          </div>
        ) : isError ? (
          <div className="p-3 text-center text-sm text-destructive">
            {t("common:error.title")}
          </div>
        ) : null
      }
      options={
        isLoading || placeholderVisible || isError
          ? []
          : statusOptions.map((status, index) => ({
              value: status.value,
              label: getStatusDisplayLabel(status.value, status.label),
              content: (
                <>
                  {getColumnIcon(status.value, status.isFinal, status.icon)}
                  <span className="text-sm">
                    {getStatusDisplayLabel(status.value, status.label)}
                  </span>
                  {task.status === status.value ? null : (
                    <ShortcutNumber number={index + 1} />
                  )}
                </>
              ),
            }))
      }
    />
  );
}
