import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { toast } from "@/lib/toast";

/**
 * Board and list context-menu delete: requests the deletion by work item key and opens the
 * approval in place. The approval dialog is the single confirmation (PA-3); nothing is
 * reported as deleted until the requester approves it.
 */
export function useRequestTaskDeletion(projectSlug: string | undefined) {
  const { t } = useTranslation();
  const { mutateAsync: deleteTask } = useDeleteTask();
  const openPendingAction = useOpenPendingAction();
  return useCallback(
    async (task: { number?: number | null }) => {
      try {
        if (!projectSlug || task.number == null)
          throw new Error(t("tasks:delete.error"));
        const pendingAction = await deleteTask(`${projectSlug}-${task.number}`);
        await openPendingAction(pendingAction);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("tasks:delete.error"),
        );
      }
    },
    [deleteTask, openPendingAction, projectSlug, t],
  );
}
