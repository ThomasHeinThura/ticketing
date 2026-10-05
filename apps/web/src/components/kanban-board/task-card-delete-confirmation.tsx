import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import { toast } from "@/lib/toast";

export default function TaskCardDeleteConfirmation({
  taskId,
  onOpenChange,
}: {
  taskId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { mutateAsync: deleteTask } = useDeleteTask();

  const handleDeleteTask = async () => {
    try {
      await deleteTask(taskId);
      toast.success(t("tasks:delete.success"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tasks:delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks:delete.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <AlertDialogClose
            render={
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteTask}
              />
            }
          >
            {t("tasks:delete.action")}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
