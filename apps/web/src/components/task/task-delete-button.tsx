import { Button } from "@taskdesk/ui";
import { Trash2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type TaskDeleteButtonProps = {
  /** The work item key (for example `PROJ-12`); deletion is requested by key. */
  workItemKey: string | undefined;
  /** Called once the deletion request is accepted, before the approval dialog opens. */
  onRequested?: () => void;
  className?: string;
};

export default function TaskDeleteButton({
  workItemKey,
  onRequested,
  className,
}: TaskDeleteButtonProps) {
  const { t } = useTranslation();
  const { canDeleteTasks, isCheckingPermissions } = useWorkspacePermission();
  const { mutateAsync: deleteTask, isPending } = useDeleteTask();
  const openPendingAction = useOpenPendingAction();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  if (isCheckingPermissions || !canDeleteTasks() || !workItemKey) {
    return null;
  }

  const handleDelete = async () => {
    const deleteTrigger = deleteButtonRef.current;
    const finalFocus = () =>
      deleteTrigger?.isConnected ? deleteTrigger : false;
    try {
      // Deletion is only requested; the task stays until the requester approves it.
      const pendingAction = await deleteTask(workItemKey);
      onRequested?.();
      await openPendingAction({ ...pendingAction, finalFocus });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  // The in-place approval dialog is the single confirmation (PA-3): no pre-confirm.
  return (
    <Button
      ref={deleteButtonRef}
      variant="ghost"
      size="sm"
      aria-label={t("tasks:delete.action")}
      className={cn(
        "text-destructive hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
      disabled={isPending}
      onClick={() => void handleDelete()}
    >
      <Trash2 className="size-4" />
      <span className="hidden sm:inline">{t("tasks:delete.action")}</span>
    </Button>
  );
}
