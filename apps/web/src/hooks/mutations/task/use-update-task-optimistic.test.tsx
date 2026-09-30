import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import updateTaskAssignee from "@/fetchers/task/update-task-assignee";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import type Task from "@/types/task";
import { useUpdateTaskAssignee } from "./use-update-task-assignee";
import { useUpdateTaskStatus } from "./use-update-task-status";

vi.mock("@/fetchers/task/update-task-assignee", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/task/update-task-status", () => ({
  default: vi.fn(),
}));

const task: Task = {
  id: "task-1",
  title: "Example task",
  number: 1,
  description: null,
  status: "backlog",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["task", task.id], task);
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hooks = renderHook(
    () => ({
      status: useUpdateTaskStatus(),
      assignee: useUpdateTaskAssignee(),
    }),
    { wrapper },
  );
  return { queryClient, ...hooks };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("optimistic legacy task updates", () => {
  it("rolls back only status when status fails while assignment succeeds", async () => {
    let rejectStatus!: (error: Error) => void;
    vi.mocked(updateTaskStatus).mockImplementation(
      () => new Promise((_resolve, reject) => (rejectStatus = reject)),
    );
    vi.mocked(updateTaskAssignee).mockResolvedValue({} as never);
    const { result, queryClient } = setup();
    let statusRequest!: Promise<unknown>;
    let assignmentRequest!: Promise<unknown>;

    act(() => {
      statusRequest = result.current.status.mutateAsync({
        ...task,
        status: "in-progress",
      });
      assignmentRequest = result.current.assignee.mutateAsync({
        ...task,
        userId: "user-2",
        assigneeId: "user-2",
        assigneeName: "Second User",
      });
    });

    await waitFor(() => {
      const current = queryClient.getQueryData<Task>(["task", task.id]);
      expect(current?.status).toBe("in-progress");
      expect(current?.userId).toBe("user-2");
    });
    await assignmentRequest;
    rejectStatus(new Error("status update failed"));
    await expect(statusRequest).rejects.toThrow("status update failed");

    const current = queryClient.getQueryData<Task>(["task", task.id]);
    expect(current?.status).toBe("backlog");
    expect(current?.userId).toBe("user-2");
    expect(current?.assigneeName).toBe("Second User");
  });

  it("rolls back only assignee fields when assignment fails after status succeeds", async () => {
    vi.mocked(updateTaskStatus).mockResolvedValue({} as never);
    vi.mocked(updateTaskAssignee).mockRejectedValue(
      new Error("assignment update failed"),
    );
    const { result, queryClient } = setup();

    const statusRequest = result.current.status.mutateAsync({
      ...task,
      status: "in-progress",
    });
    await statusRequest;
    const assignmentRequest = result.current.assignee.mutateAsync({
      ...task,
      status: "in-progress",
      userId: "user-2",
      assigneeId: "user-2",
      assigneeName: "Second User",
    });
    await expect(assignmentRequest).rejects.toThrow("assignment update failed");

    const current = queryClient.getQueryData<Task>(["task", task.id]);
    expect(current?.status).toBe("in-progress");
    expect(current?.userId).toBeNull();
    expect(current?.assigneeId).toBeNull();
    expect(current?.assigneeName).toBeNull();
  });
});
