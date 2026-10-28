import { useMemo, useState } from "react";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import {
  TaskCrumbOptionsPresentation,
  TaskCrumbPresentation,
} from "./task-crumb-presentation";

type TaskCrumbSelectProps = {
  projectId: string;
  taskId: string;
  taskLabel?: string;
  onSelectTask: (taskId: string) => void;
};

export default function TaskCrumbSelect({
  projectId,
  taskId,
  taskLabel,
  onSelectTask,
}: TaskCrumbSelectProps) {
  const [open, setOpen] = useState(false);
  return (
    <TaskCrumbPresentation open={open} onOpenChange={setOpen} label={taskLabel}>
      <TaskCrumbOptions
        projectId={projectId}
        taskId={taskId}
        onSelectTask={onSelectTask}
      />
    </TaskCrumbPresentation>
  );
}

function TaskCrumbOptions({
  projectId,
  taskId,
  onSelectTask,
}: Pick<TaskCrumbSelectProps, "projectId" | "taskId" | "onSelectTask">) {
  const { data: project } = useGetTasks(projectId);
  const tasks = useMemo(
    () => [
      ...(project?.columns?.flatMap((column) => column.tasks) ?? []),
      ...(project?.plannedTasks ?? []),
      ...(project?.archivedTasks ?? []),
    ],
    [project],
  );
  return (
    <TaskCrumbOptionsPresentation
      onSelect={onSelectTask}
      options={tasks.map((task) => ({
        value: task.id,
        label: `${task.number != null ? `#${task.number} ` : ""}${task.title}`,
        disabled: task.id === taskId,
      }))}
    />
  );
}
