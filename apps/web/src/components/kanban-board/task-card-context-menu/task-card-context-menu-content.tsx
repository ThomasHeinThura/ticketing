import { ContextMenuItem } from "@taskdesk/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useUpdateTaskAssignee } from "@/hooks/mutations/task/use-update-task-assignee";
import { useUpdateTaskDescription } from "@/hooks/mutations/task/use-update-task-description";
import { useUpdateTaskDueDate } from "@/hooks/mutations/task/use-update-task-due-date";
import { useUpdateTaskStatus } from "@/hooks/mutations/task/use-update-task-status";
import { useUpdateTaskPriority } from "@/hooks/mutations/task/use-update-task-status-priority";
import { useUpdateTaskTitle } from "@/hooks/mutations/task/use-update-task-title";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { generateLink } from "@/lib/generate-link";
import { TaskUpdateError } from "@/lib/task-update-error";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import TaskContextMenuPresentation from "./task-context-menu-presentation";

type TaskCardContext = {
  worskpaceId: string;
  projectId: string;
};

type TaskCardContextMenuContentProps = {
  task: Task;
  taskCardContext: TaskCardContext;
  onDeleteClick: () => void;
};

export default function TaskCardContextMenuContent({
  task,
  taskCardContext,
  onDeleteClick,
}: TaskCardContextMenuContentProps) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const { project } = useProjectStore();
  const { data: columnsData = [] } = useGetColumns(taskCardContext.projectId);
  const columns =
    project?.columns && project.columns.length > 0
      ? project.columns.map((col) => ({
          slug: col.id,
          name: col.name,
          icon: col.icon,
          isFinal: col.isFinal,
        }))
      : columnsData.map((col) => ({
          slug: col.slug,
          name: col.name,
          icon: col.icon,
          isFinal: col.isFinal,
        }));
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    taskCardContext.worskpaceId,
  );
  const { mutateAsync: updateTask } = useUpdateTask();
  const { mutateAsync: updateTaskPriority } = useUpdateTaskPriority();
  const { mutateAsync: updateTaskStatus } = useUpdateTaskStatus();
  const { mutateAsync: updateTaskAssignee } = useUpdateTaskAssignee();
  const { mutateAsync: updateTaskTitle } = useUpdateTaskTitle();
  const { mutateAsync: updateTaskDescription } = useUpdateTaskDescription();
  const { mutateAsync: updateTaskDueDate } = useUpdateTaskDueDate();
  const { canUpdateTasks, canDeleteTasks, canAssignTasks } =
    useWorkspacePermission();
  const canEdit = canUpdateTasks();
  const canDelete = canDeleteTasks();
  const canAssign = canAssignTasks();

  const usersOptions = useMemo(() => {
    return workspaceUsers?.members?.map((member) => ({
      label: member?.user?.name ?? member.userId,
      value: member.userId,
      image: member?.user?.image ?? "",
      name: member?.user?.name ?? "",
    }));
  }, [workspaceUsers]);

  const handleCopyTaskLink = () => {
    const path = `/dashboard/workspace/${taskCardContext.worskpaceId}/project/${taskCardContext.projectId}/task/${task.id}`;
    const taskLink = generateLink(path);

    navigator.clipboard.writeText(taskLink);
    toast.success(t("tasks:contextMenu.copyLinkSuccess"));
  };

  const handleChange = async (field: keyof Task, value: string | Date) => {
    try {
      switch (field) {
        case "priority":
          await updateTaskPriority({ ...task, priority: value as string });
          break;
        case "status":
          await updateTaskStatus({ ...task, status: value as string });
          break;
        case "userId":
          await updateTaskAssignee({ ...task, userId: value as string });
          break;
        case "title":
          await updateTaskTitle({ ...task, title: value as string });
          break;
        case "description":
          await updateTaskDescription({
            ...task,
            description: value as string,
          });
          break;
        default:
          await updateTask({
            ...task,
            [field]: value,
          });
      }
      toast.success(t("tasks:update.success"));
    } catch (error) {
      if (!(error instanceof TaskUpdateError)) {
        toast.error(
          error instanceof Error ? error.message : t("tasks:update.error"),
        );
      }
    }
  };

  return (
    <TaskContextMenuPresentation
      onCopyLink={handleCopyTaskLink}
      priority={
        canEdit
          ? {
              value: task.priority,
              onChange: (value) => void handleChange("priority", value),
            }
          : undefined
      }
      states={
        canEdit
          ? {
              value: task.status,
              options: columns.map((col) => ({
                value: col.slug,
                name: col.name,
                icon: col.icon,
                isFinal: col.isFinal,
              })),
              onChange: (value) => void handleChange("status", value),
            }
          : undefined
      }
      dueDate={
        canEdit
          ? {
              value: task.dueDate ? new Date(task.dueDate) : undefined,
              weekStartsOn,
              onChange: async (date) => {
                try {
                  await updateTaskDueDate({
                    ...task,
                    dueDate: date?.toISOString() || null,
                  });
                  toast.success(
                    t(
                      date
                        ? "tasks:dueDate.updateSuccess"
                        : "tasks:dueDate.clearSuccess",
                    ),
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t(
                          date
                            ? "tasks:dueDate.updateError"
                            : "tasks:dueDate.clearError",
                        ),
                  );
                }
              },
            }
          : undefined
      }
      assignee={
        canAssign && usersOptions
          ? {
              value: task.userId,
              options: usersOptions,
              onChange: (value) => void handleChange("userId", value),
            }
          : undefined
      }
      onArchive={
        canEdit ? () => void handleChange("status", "archived") : undefined
      }
      extraArchiveAction={
        task.status !== "planned" ? (
          <ContextMenuItem onClick={() => handleChange("status", "planned")}>
            <span>{t("tasks:actions.markAsPlanned")}</span>
          </ContextMenuItem>
        ) : undefined
      }
      onDelete={
        canDelete
          ? () => {
              setTimeout(onDeleteClick, 0);
            }
          : undefined
      }
    />
  );
}
