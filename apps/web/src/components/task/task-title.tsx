import { useQueryClient } from "@tanstack/react-query";
import { Form, FormField } from "@taskdesk/ui";
import { memo, useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { useUpdateTaskTitle } from "@/hooks/mutations/task/use-update-task-title";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import debounce from "@/lib/debounce";
import type Task from "@/types/task";

type TaskTitleProps = {
  taskId: string;
  task?: Pick<Task, "title">;
};

function TaskTitle({ taskId, task }: TaskTitleProps) {
  const { t } = useTranslation();
  const { data: fetchedTitle } = useGetTask(
    taskId,
    (currentTask) => currentTask.title,
    !task,
  );
  const title = task?.title ?? fetchedTitle;
  const queryClient = useQueryClient();
  const { mutateAsync: updateTaskTitle } = useUpdateTaskTitle();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();
  const isInitializedRef = useRef(false);
  const taskIdRef = useRef(taskId);
  const updateTaskRef = useRef(updateTaskTitle);

  useEffect(() => {
    taskIdRef.current = taskId;
    updateTaskRef.current = updateTaskTitle;
  }, [taskId, updateTaskTitle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId is not needed here
  useEffect(() => {
    isInitializedRef.current = false;
  }, [taskId]);

  const form = useForm<{
    title: string;
  }>({
    values: {
      title: title || "",
    },
  });

  useEffect(() => {
    if (title !== undefined) isInitializedRef.current = true;
  }, [title]);

  const debouncedUpdate = useCallback(
    debounce(async (title: string) => {
      if (!isInitializedRef.current) return;

      const currentTask = queryClient.getQueryData<Task>([
        "task",
        taskIdRef.current,
      ]);
      const updateTaskFn = updateTaskRef.current;

      if (!currentTask || !updateTaskFn) return;

      try {
        await updateTaskFn({
          ...currentTask,
          title,
        });
      } catch (error) {
        console.error("Failed to update title:", error);
      }
    }, 800),
    [],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!isInitializedRef.current) return;

      debouncedUpdate(value);
    },
    [debouncedUpdate],
  );

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <input
            {...field}
            type="text"
            placeholder={t("tasks:detail.titlePlaceholder")}
            readOnly={!canEdit}
            className="block h-auto w-full appearance-none border-0 bg-transparent p-0 font-heading text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em] text-foreground outline-none placeholder:text-foreground"
            onChange={(e) => {
              field.onChange(e);
              handleTitleChange(e.target.value);
            }}
          />
        )}
      />
    </Form>
  );
}

export default memo(TaskTitle);
