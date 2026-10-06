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
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
  it("does not republish a status cache value already shown optimistically", async () => {
    vi.mocked(updateTaskStatus).mockResolvedValue({} as never);
    const { result, queryClient } = setup();
    let taskDataWrites = 0;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.query.queryKey[0] === "task" &&
        event.query.queryKey[1] === task.id &&
        event.action.type === "success"
      )
        taskDataWrites += 1;
    });

    const request = result.current.status.mutateAsync({
      ...task,
      status: "in-progress",
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(1));
    const optimisticTask = queryClient.getQueryData<Task>(["task", task.id]);
    await request;

    expect(queryClient.getQueryData<Task>(["task", task.id])).toBe(
      optimisticTask,
    );
    expect(taskDataWrites).toBe(1);
    unsubscribe();
  });

  it("does not republish confirmed assignee fields already shown optimistically", async () => {
    vi.mocked(updateTaskAssignee).mockResolvedValue({} as never);
    const { result, queryClient } = setup();
    let taskDataWrites = 0;
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.query.queryKey[0] === "task" &&
        event.query.queryKey[1] === task.id &&
        event.action.type === "success"
      )
        taskDataWrites += 1;
    });

    const request = result.current.assignee.mutateAsync({
      ...task,
      userId: "user-2",
      assigneeId: "user-2",
      assigneeName: "Second User",
    });
    await waitFor(() => expect(updateTaskAssignee).toHaveBeenCalledTimes(1));
    const optimisticTask = queryClient.getQueryData<Task>(["task", task.id]);
    await request;

    expect(queryClient.getQueryData<Task>(["task", task.id])).toBe(
      optimisticTask,
    );
    expect(taskDataWrites).toBe(1);
    unsubscribe();
  });

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

  it("does not roll back a newer status after an older status request fails", async () => {
    let rejectFirstStatus!: (error: Error) => void;
    vi.mocked(updateTaskStatus)
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => (rejectFirstStatus = reject)),
      )
      .mockResolvedValueOnce({} as never);
    const { result, queryClient } = setup();

    let firstRequest!: Promise<unknown>;
    act(() => {
      firstRequest = result.current.status.mutateAsync({
        ...task,
        status: "in-progress",
      });
    });
    await waitFor(() => {
      expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
        "in-progress",
      );
    });

    await result.current.status.mutateAsync({ ...task, status: "done" });
    rejectFirstStatus(new Error("older status update failed"));
    await expect(firstRequest).rejects.toThrow("older status update failed");

    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "done",
    );
  });

  it("restores the confirmed status when two overlapping status writes fail", async () => {
    const first = deferred<Awaited<ReturnType<typeof updateTaskStatus>>>();
    const second = deferred<Awaited<ReturnType<typeof updateTaskStatus>>>();
    vi.mocked(updateTaskStatus)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result, queryClient } = setup();

    let firstRequest!: Promise<unknown>;
    act(() => {
      firstRequest = result.current.status.mutateAsync({
        ...task,
        status: "in-progress",
      });
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(1));

    let secondRequest!: Promise<unknown>;
    act(() => {
      secondRequest = result.current.status.mutateAsync({
        ...task,
        status: "done",
      });
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "done",
    );

    queryClient.setQueryData<Task>(["task", task.id], (current) =>
      current
        ? {
            ...current,
            title: "Fresh full task",
            version: 9,
            userId: "user-3",
            assigneeId: "user-3",
            assigneeName: "Third User",
          }
        : current,
    );
    first.reject(new Error("first status write failed"));
    await expect(firstRequest).rejects.toThrow("first status write failed");
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "done",
    );

    second.reject(new Error("second status write failed"));
    await expect(secondRequest).rejects.toThrow("second status write failed");
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual({
      ...task,
      title: "Fresh full task",
      version: 9,
      userId: "user-3",
      assigneeId: "user-3",
      assigneeName: "Third User",
    });
    expect(queryClient.getQueryState(["task", task.id])?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(["task", task.id])?.fetchStatus).toBe(
      "idle",
    );
  });

  it("keeps the earlier pending status if the newer write fails first", async () => {
    const first = deferred<Awaited<ReturnType<typeof updateTaskStatus>>>();
    const second = deferred<Awaited<ReturnType<typeof updateTaskStatus>>>();
    vi.mocked(updateTaskStatus)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result, queryClient } = setup();

    const firstRequest = result.current.status.mutateAsync({
      ...task,
      status: "in-progress",
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(1));
    const secondRequest = result.current.status.mutateAsync({
      ...task,
      status: "done",
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(2));

    second.reject(new Error("newer status write failed"));
    await expect(secondRequest).rejects.toThrow("newer status write failed");
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "in-progress",
    );

    first.resolve({} as never);
    await firstRequest;
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "in-progress",
    );
  });

  it("restores an earlier successful status when the newer write fails", async () => {
    const first = deferred<Awaited<ReturnType<typeof updateTaskStatus>>>();
    const second = deferred<Awaited<ReturnType<typeof updateTaskStatus>>>();
    vi.mocked(updateTaskStatus)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result, queryClient } = setup();

    const firstRequest = result.current.status.mutateAsync({
      ...task,
      status: "in-progress",
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(1));
    const secondRequest = result.current.status.mutateAsync({
      ...task,
      status: "done",
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledTimes(2));

    first.resolve({} as never);
    await firstRequest;
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "done",
    );

    second.reject(new Error("newer status write failed"));
    await expect(secondRequest).rejects.toThrow("newer status write failed");
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "in-progress",
    );
  });

  it("restores confirmed assignee fields when overlapping assignment writes fail in reverse order", async () => {
    const first = deferred<Awaited<ReturnType<typeof updateTaskAssignee>>>();
    const second = deferred<Awaited<ReturnType<typeof updateTaskAssignee>>>();
    vi.mocked(updateTaskAssignee)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result, queryClient } = setup();

    const firstRequest = result.current.assignee.mutateAsync({
      ...task,
      userId: "user-1",
      assigneeId: "user-1",
      assigneeName: "First User",
    });
    await waitFor(() => expect(updateTaskAssignee).toHaveBeenCalledTimes(1));
    const secondRequest = result.current.assignee.mutateAsync({
      ...task,
      userId: "user-2",
      assigneeId: "user-2",
      assigneeName: "Second User",
    });
    await waitFor(() => expect(updateTaskAssignee).toHaveBeenCalledTimes(2));

    second.reject(new Error("newer assignment failed"));
    await expect(secondRequest).rejects.toThrow("newer assignment failed");
    expect(queryClient.getQueryData<Task>(["task", task.id])?.userId).toBe(
      "user-1",
    );

    first.reject(new Error("older assignment failed"));
    await expect(firstRequest).rejects.toThrow("older assignment failed");
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual(task);
  });

  it("cancels an in-flight detail read before applying an optimistic status", async () => {
    vi.mocked(updateTaskStatus).mockResolvedValue({} as never);
    const { result, queryClient } = setup();
    let resolveFetch!: (value: Task) => void;
    let fetchSignal: AbortSignal | undefined;
    const pendingFetch = queryClient.fetchQuery({
      queryKey: ["task", task.id],
      queryFn: ({ signal }) => {
        fetchSignal = signal;
        return new Promise<Task>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });
    void pendingFetch.catch(() => undefined);

    await waitFor(() => {
      expect(queryClient.isFetching({ queryKey: ["task", task.id] })).toBe(1);
    });
    await result.current.status.mutateAsync({
      ...task,
      status: "in-progress",
    });

    expect(fetchSignal?.aborted).toBe(true);
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "in-progress",
    );

    resolveFetch({ ...task, title: "Late stale response" });
    await Promise.resolve();
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "in-progress",
    );
  });

  it("shows the optimistic status while a canceled detail transport is still pending", async () => {
    let resolveFetch!: (value: Task) => void;
    let resolveMutation!: (
      value: Awaited<ReturnType<typeof updateTaskStatus>>,
    ) => void;
    let fetchSignal: AbortSignal | undefined;
    vi.mocked(updateTaskStatus).mockImplementation(
      () => new Promise((resolve) => (resolveMutation = resolve)),
    );
    const { result, queryClient } = setup();
    const pendingFetch = queryClient.fetchQuery({
      queryKey: ["task", task.id],
      queryFn: ({ signal }) => {
        fetchSignal = signal;
        return new Promise<Task>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });
    void pendingFetch.catch(() => undefined);
    await waitFor(() => {
      expect(queryClient.isFetching({ queryKey: ["task", task.id] })).toBe(1);
    });

    let statusRequest!: Promise<unknown>;
    act(() => {
      statusRequest = result.current.status.mutateAsync({
        ...task,
        status: "in-progress",
      });
    });

    expect(fetchSignal?.aborted).toBe(true);
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual({
      ...task,
      status: "in-progress",
    });
    await waitFor(() => expect(updateTaskStatus).toHaveBeenCalledOnce());

    resolveFetch({ ...task, title: "Late stale response" });
    await Promise.resolve();
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual({
      ...task,
      status: "in-progress",
    });

    resolveMutation({} as never);
    await statusRequest;
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual({
      ...task,
      status: "in-progress",
    });
  });

  it("rolls back after a failed status write without accepting a late canceled read", async () => {
    let resolveFetch!: (value: Task) => void;
    let fetchSignal: AbortSignal | undefined;
    vi.mocked(updateTaskStatus).mockRejectedValue(
      new Error("status update failed"),
    );
    const { result, queryClient } = setup();
    const pendingFetch = queryClient.fetchQuery({
      queryKey: ["task", task.id],
      queryFn: ({ signal }) => {
        fetchSignal = signal;
        return new Promise<Task>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });
    void pendingFetch.catch(() => undefined);
    await waitFor(() => {
      expect(queryClient.isFetching({ queryKey: ["task", task.id] })).toBe(1);
    });

    let statusRequest!: Promise<unknown>;
    act(() => {
      statusRequest = result.current.status.mutateAsync({
        ...task,
        status: "in-progress",
      });
    });

    expect(fetchSignal?.aborted).toBe(true);
    expect(queryClient.getQueryData<Task>(["task", task.id])?.status).toBe(
      "in-progress",
    );
    await expect(statusRequest).rejects.toThrow("status update failed");

    resolveFetch({ ...task, title: "Late stale response" });
    await Promise.resolve();
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual(task);
  });

  it("shows the optimistic assignee while a canceled detail transport is pending", async () => {
    let resolveFetch!: (value: Task) => void;
    let resolveMutation!: (
      value: Awaited<ReturnType<typeof updateTaskAssignee>>,
    ) => void;
    let fetchSignal: AbortSignal | undefined;
    vi.mocked(updateTaskAssignee).mockImplementation(
      () => new Promise((resolve) => (resolveMutation = resolve)),
    );
    const { result, queryClient } = setup();
    const pendingFetch = queryClient.fetchQuery({
      queryKey: ["task", task.id],
      queryFn: ({ signal }) => {
        fetchSignal = signal;
        return new Promise<Task>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });
    void pendingFetch.catch(() => undefined);
    await waitFor(() => {
      expect(queryClient.isFetching({ queryKey: ["task", task.id] })).toBe(1);
    });

    let assignmentRequest!: Promise<unknown>;
    act(() => {
      assignmentRequest = result.current.assignee.mutateAsync({
        ...task,
        userId: "user-2",
        assigneeId: "user-2",
        assigneeName: "Second User",
      });
    });

    expect(fetchSignal?.aborted).toBe(true);
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual({
      ...task,
      userId: "user-2",
      assigneeId: "user-2",
      assigneeName: "Second User",
    });
    await waitFor(() => expect(updateTaskAssignee).toHaveBeenCalledOnce());

    resolveFetch({ ...task, title: "Late stale response" });
    await Promise.resolve();
    resolveMutation({} as never);
    await assignmentRequest;

    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual({
      ...task,
      userId: "user-2",
      assigneeId: "user-2",
      assigneeName: "Second User",
    });
  });

  it("rolls back a failed assignee write without accepting a late canceled read", async () => {
    let resolveFetch!: (value: Task) => void;
    let fetchSignal: AbortSignal | undefined;
    vi.mocked(updateTaskAssignee).mockRejectedValue(
      new Error("assignment update failed"),
    );
    const { result, queryClient } = setup();
    const pendingFetch = queryClient.fetchQuery({
      queryKey: ["task", task.id],
      queryFn: ({ signal }) => {
        fetchSignal = signal;
        return new Promise<Task>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });
    void pendingFetch.catch(() => undefined);
    await waitFor(() => {
      expect(queryClient.isFetching({ queryKey: ["task", task.id] })).toBe(1);
    });

    let assignmentRequest!: Promise<unknown>;
    act(() => {
      assignmentRequest = result.current.assignee.mutateAsync({
        ...task,
        userId: "user-2",
        assigneeId: "user-2",
        assigneeName: "Second User",
      });
    });

    expect(fetchSignal?.aborted).toBe(true);
    expect(queryClient.getQueryData<Task>(["task", task.id])?.userId).toBe(
      "user-2",
    );
    await expect(assignmentRequest).rejects.toThrow("assignment update failed");

    resolveFetch({ ...task, title: "Late stale response" });
    await Promise.resolve();
    expect(queryClient.getQueryData<Task>(["task", task.id])).toEqual(task);
  });
});
