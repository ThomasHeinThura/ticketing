import { Badge, Button } from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { memo } from "react";
import type useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import { resolveLabelColor } from "@/lib/label-color";
import TaskLabelsPopover from "./task-labels-popover";

type TaskLabelsSectionProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  taskLabels: NonNullable<ReturnType<typeof useGetLabelsByTask>["data"]>;
  heading: string;
};

/**
 * Keep label controls stable while task properties such as status and assignee
 * change. The parent sidebar observes the task query; label controls only need
 * the task identity, project identity, and the labels query result.
 */
function TaskLabelsSection({
  taskId,
  projectId,
  workspaceId,
  taskLabels,
  heading,
}: TaskLabelsSectionProps) {
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(workspaceId);

  return (
    <div className="hidden lg:flex px-3 flex-col gap-3 p-2">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-foreground px-2">
          {heading}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 px-2">
          {taskLabels.map((label) => (
            <TaskLabelsPopover
              key={`edit-${label.id}`}
              taskId={taskId}
              projectId={projectId}
              workspaceId={workspaceId}
              taskLabels={taskLabels}
              workspaceLabels={workspaceLabels}
              triggerNativeButton={false}
            >
              <Badge
                variant="outline"
                className="flex items-center gap-1 px-1.5 py-0.5 cursor-pointer hover:bg-accent/50 transition-colors text-[10px]"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: resolveLabelColor(label.color) }}
                />
                <span className="truncate max-w-[60px]">{label.name}</span>
              </Badge>
            </TaskLabelsPopover>
          ))}

          <TaskLabelsPopover
            taskId={taskId}
            projectId={projectId}
            workspaceId={workspaceId}
            taskLabels={taskLabels}
            workspaceLabels={workspaceLabels}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 rounded-full"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </TaskLabelsPopover>
        </div>
      </div>
    </div>
  );
}

export default memo(TaskLabelsSection);
