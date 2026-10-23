import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import requestTaskDeletion from "@/fetchers/task/delete-task";
import useProjectStore from "@/store/project";
import type Task from "@/types/task";
import { useDeleteTask } from "./use-delete-task";

vi.mock("@/fetchers/task/delete-task", () => ({
  default: vi.fn(),
}));

function makeTask(id: string): Task {
  return {
    id,
    title: id,
    number: 1,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    version: 1,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
  };
}

function makeProject() {
  return {
    id: "project-1",
    name: "Project",
    slug: "PROJ",
    icon: null,
    description: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    workspaceId: "workspace-1",
    columns: [
      {
        id: "todo",
        slug: "to-do",
        name: "To Do",
        icon: null,
        isFinal: false,
        tasks: [makeTask("delete-me"), makeTask("keep-me")],
      },
    ],
    plannedTasks: [makeTask("delete-me")],
    archivedTasks: [makeTask("delete-me")],
  };
}

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  vi.clearAllMocks();
  useProjectStore.getState().setProject(undefined);
});

afterEach(() => {
  queryClient.clear();
  useProjectStore.getState().setProject(undefined);
});

describe("useDeleteTask", () => {
  it("requests deletion by work item key and removes nothing until approval", async () => {
    const project = makeProject();
    const task = makeTask("delete-me");
    queryClient.setQueryData(["tasks", project.id], project);
    queryClient.setQueryData(["task", task.id], task);
    useProjectStore.getState().setProject(project);
    vi.mocked(requestTaskDeletion).mockResolvedValue({
      pendingActionId: "pa-1",
    });

    const { result } = renderHook(() => useDeleteTask(), { wrapper: Wrapper });

    let requested: unknown;
    await act(async () => {
      requested = await result.current.mutateAsync("PROJ-1");
    });

    expect(requestTaskDeletion).toHaveBeenCalledWith("PROJ-1");
    expect(requested).toEqual({ pendingActionId: "pa-1" });
    expect(queryClient.getQueryData(["tasks", project.id])).toEqual(project);
    expect(queryClient.getQueryData(["task", task.id])).toEqual(task);
    expect(useProjectStore.getState().project).toEqual(project);
  });

  it("leaves query and project-store state unchanged when the request fails", async () => {
    const project = makeProject();
    const task = makeTask("delete-me");
    queryClient.setQueryData(["tasks", project.id], project);
    queryClient.setQueryData(["task", task.id], task);
    useProjectStore.getState().setProject(project);
    vi.mocked(requestTaskDeletion).mockRejectedValue(
      new Error("Delete failed"),
    );

    const { result } = renderHook(() => useDeleteTask(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync("PROJ-1")).rejects.toThrow(
        "Delete failed",
      );
    });

    expect(queryClient.getQueryData(["tasks", project.id])).toEqual(project);
    expect(queryClient.getQueryData(["task", task.id])).toEqual(task);
    expect(useProjectStore.getState().project).toEqual(project);
  });
});
