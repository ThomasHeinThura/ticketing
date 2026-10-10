import type Task from "@/types/task";

export function selectTaskDescription(task: Task) {
  return { description: task.description };
}
