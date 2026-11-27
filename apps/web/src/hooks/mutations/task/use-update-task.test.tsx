import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import updateTask from "@/fetchers/task/update-task";
import { TaskUpdateError } from "@/lib/task-update-error";
import { toast } from "@/lib/toast";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
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
});

afterEach(() => {
  queryClient.clear();
});

describe("useUpdateTask conflict recovery", () => {
  it("reports a 409 once and refreshes the active query's current data", async () => {
    const staleTask = task("task-1");
    const currentTask = task("task-1", {
      status: "in-progress",
      position: 1,
      version: 6,
    });
    const staleProject = project([staleTask]);
    const currentProject = project([], [currentTask]);
    queryClient.setQueryData(["tasks", staleProject.id], staleProject);
    vi.mocked(updateTask).mockRejectedValue(
      new TaskUpdateError(409, "Failed to update task"),
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
      expect(queryClient.getQueryData(["tasks", staleProject.id])).toEqual(
        currentProject,
      );
    });

    expect(toast.error).toHaveBeenCalledWith("tasksExtra:update.conflict");
    expect(updateTask).toHaveBeenCalledTimes(1);
  });

  it("shows one hook-owned toast for transport failures and refreshes the active query", async () => {
    const staleTask = task("task-1");
    const staleProject = project([staleTask]);
    const emptyProject = project([]);
    queryClient.setQueryData(["tasks", staleProject.id], staleProject);
    vi.mocked(updateTask).mockRejectedValue(
      new TaskUpdateError(0, "Failed to update task", {
        cause: new TypeError("Network request failed"),
      }),
    );

    const { result } = renderHook(
      () => {
        useQuery({
          queryKey: ["tasks", staleProject.id],
          queryFn: async () => emptyProject,
        });
        return useUpdateTask();
      },
      { wrapper },
    );

    await act(async () => {
      await expect(
        result.current.mutateAsync(staleTask),
      ).rejects.toBeInstanceOf(TaskUpdateError);
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(["tasks", staleProject.id])).toEqual(
        emptyProject,
      );
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("tasksExtra:update.error");
    expect(updateTask).toHaveBeenCalledTimes(1);
  });
});
