import {
  Button,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@taskdesk/ui";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { TaskUpdateError } from "@/lib/task-update-error";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";

type TaskStartDatePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskStartDatePopover({
  task,
  children,
}: TaskStartDatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const handleDateChange = async (date: Date | undefined) => {
    try {
      await updateTask({
        ...task,
        startDate: date?.toISOString() || null,
      });
      toast.success(t("tasks:popover.startDate.updateSuccess"));
      setOpen(false);
    } catch (error) {
      if (!(error instanceof TaskUpdateError)) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.startDate.updateError"),
        );
      }
    }
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={task.startDate ? new Date(task.startDate) : undefined}
          onSelect={handleDateChange}
          disabled={
            task.dueDate ? { after: new Date(task.dueDate) } : undefined
          }
          className="w-full bg-popover"
          weekStartsOn={weekStartsOn}
        />
        {task.startDate && (
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => handleDateChange(undefined)}
            >
              <X className="h-4 w-4" />
              {t("tasks:popover.startDate.clear")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
