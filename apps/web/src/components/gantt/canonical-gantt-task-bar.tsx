import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { GanttTaskBar } from "@/components/gantt/gantt-task-bar";
import {
  currentWorkItemVersion,
  workItemMutationScope,
  writeWorkItemResponse,
} from "@/components/work-item/work-item-save";
import updateWorkItem from "@/fetchers/work-item/update-work-item";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

function preserveTime(day: Date, original: string | null) {
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return `${date}${original?.slice(10) || "T00:00:00.000Z"}`;
}
export function CanonicalGanttTaskBar(
  props: ComponentProps<typeof GanttTaskBar> & { workspaceId: string },
) {
  const { task, workspaceId } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const permission = useWorkspacePermission(workspaceId, task.projectId);
  const save = useMutation({
    scope: workItemMutationScope(task.id),
    mutationFn: async ({ start, end }: { start: Date; end: Date }) => {
      const updated = await updateWorkItem({
        key: task.id,
        version: currentWorkItemVersion(queryClient, {
          key: task.id,
          version: task.version,
        }),
        startDate: preserveTime(start, task.startDate),
        dueDate: preserveTime(end, task.dueDate),
      });
      writeWorkItemResponse(queryClient, task.id, updated, {
        startDate: updated.startDate,
        dueDate: updated.dueDate,
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["work-items", task.projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "detail", task.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "activity", task.id],
        }),
      ]);
    },
  });
  return (
    <GanttTaskBar
      {...props}
      canEditDates={
        !permission.isCheckingPermissions &&
        permission.canUpdateTasks() &&
        !save.isPending
      }
      onDatesChange={async (start, end) => {
        try {
          await save.mutateAsync({ start, end });
        } catch {
          throw new Error(t("workItems:journey.saveError"));
        }
      }}
    />
  );
}
