import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import updateTask from "@/fetchers/task/update-task";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { restoreTaskUpdate } from "./restore-task-update";
import { useUpdateTask } from "./use-update-task";

vi.mock("@/fetchers/task/update-task", () => ({ default: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    number: 1,
    description: null,
    status: "to-do",
    priority: "medium",
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    version: 5,
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    ...overrides,
  };
}

function project(
  todoTasks: Task[],
  inProgressTasks: Task[] = [],
): ProjectWithTasks {
  return {
    id: "project-1",
    name: "Project",
    slug: "PROJ",
    icon: null,
    description: null,
    workspaceId: "workspace-1",
    columns: [
      {
        id: "todo",
        slug: "to-do",
        name: "To Do",
        icon: null,
        isFinal: false,
        tasks: todoTasks,
      },
      {
        id: "in-progress",
        slug: "in-progress",
        name: "In Progress",
        icon: null,
        isFinal: false,
        tasks: inProgressTasks,
      },
    ],
    plannedTasks: [],
    archivedTasks: [],
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: 1, retryDelay: 0 },
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  vi.clearAllMocks();
  useProjectStore.getState().setProject(undefined);
});

afterEach(() => {
  queryClient.clear();
  useProjectStore.getState().setProject(undefined);
});

describe("useUpdateTask conflict recovery", () => {
  it("reports a 409 once and restores the board from the active query's current data", async () => {
    const staleTask = task("task-1");
    const currentTask = task("task-1", {
      status: "in-progress",
      position: 1,
      version: 6,
    });
    const staleProject = project([staleTask]);
    const currentProject = project([], [currentTask]);
    queryClient.setQueryData(["tasks", staleProject.id], staleProject);
    useProjectStore.getState().setProject(staleProject);
    vi.mocked(updateTask).mockRejectedValue(
      new HttpError(409, "Failed to update task"),
    );

    const { result } = renderHook(
      () => {
        useQuery({
          queryKey: ["tasks", staleProject.id],
          queryFn: async () => currentProject,
        });
        return useUpdateTask();
      },
      { wrapper },
    );

    await act(async () => {
      await expect(result.current.mutateAsync(staleTask)).rejects.toMatchObject(
        {
          status: 409,
        },
      );
    });

    await waitFor(() => {
      const storedTask = useProjectStore
        .getState()
        .project?.columns.flatMap(({ tasks }) => tasks)
        .find(({ id }) => id === currentTask.id);
      expect(storedTask).toMatchObject({
        status: "in-progress",
        version: 6,
      });
    });

    expect(toast.error).toHaveBeenCalledWith("tasks:update.conflict");
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["tasks", staleProject.id])).toEqual(
      currentProject,
    );
  });

  it("restores only the failed task and preserves later optimistic edits to other rows", () => {
    const attemptedTask = task("task-1", { status: "to-do" });
    const laterLocalTask = task("task-2", { title: "Later local edit" });
    const currentLocalProject = project([attemptedTask, laterLocalTask]);
    const authoritativeProject = project(
      [task("task-2")],
      [task("task-1", { status: "in-progress", version: 6 })],
    );

    const restored = restoreTaskUpdate(
      currentLocalProject,
      authoritativeProject,
      attemptedTask.id,
      attemptedTask,
    );

    expect(restored.columns[1]?.tasks[0]).toMatchObject({
      id: "task-1",
      status: "in-progress",
      version: 6,
    });
    expect(restored.columns[0]?.tasks[0]).toMatchObject({
      id: "task-2",
      title: "Later local edit",
    });

    const newerTaskEdit = task("task-1", {
      title: "A newer local edit",
      status: "to-do",
    });
    const newerLocalProject = project([newerTaskEdit, laterLocalTask]);
    expect(
      restoreTaskUpdate(
        newerLocalProject,
        authoritativeProject,
        newerTaskEdit.id,
        attemptedTask,
      ),
    ).toBe(newerLocalProject);
  });
});
