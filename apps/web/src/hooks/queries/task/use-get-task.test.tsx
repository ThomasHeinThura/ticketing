import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectTaskDetailsSummary } from "@/components/task/task-details-content";
import { selectTaskDescription } from "./select-task-description";
import useGetTask from "./use-get-task";

const mocks = vi.hoisted(() => ({ getTask: vi.fn() }));

vi.mock("@/fetchers/task/get-task", () => ({ default: mocks.getTask }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useGetTask cancellation", () => {
  it("aborts the request when a detail mutation cancels the task query", async () => {
    mocks.getTask.mockImplementation(
      (_taskId: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useGetTask("task-1"), { wrapper });

    await waitFor(() => expect(mocks.getTask).toHaveBeenCalledOnce());
    const signal = mocks.getTask.mock.calls[0][1] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      await queryClient.cancelQueries({ queryKey: ["task", "task-1"] });
    });

    expect(signal.aborted).toBe(true);
    queryClient.clear();
  });

  it("keeps the task detail summary stable when property fields change", async () => {
    mocks.getTask.mockResolvedValue({
      id: "task-1",
      title: "Stable title",
      status: "todo",
      userId: null,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useGetTask("task-1", selectTaskDetailsSummary),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.data).toEqual({
        number: undefined,
        title: "Stable title",
        description: undefined,
      }),
    );
    const summary = result.current.data;
    await act(async () => {
      queryClient.setQueryData(["task", "task-1"], {
        id: "task-1",
        title: "Stable title",
        status: "in-progress",
        userId: "assignee-2",
      });
    });

    expect(result.current.data).toBe(summary);
    queryClient.clear();
  });

  it("keeps a description-only observer stable when task properties change", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["task", "task-1"], {
      id: "task-1",
      title: "Stable title",
      description: "Stable description",
      status: "todo",
      userId: null,
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useGetTask("task-1", selectTaskDescription, false).data;
      },
      { wrapper },
    );
    const description = result.current;
    const renderCount = renders;

    act(() => {
      queryClient.setQueryData(["task", "task-1"], {
        id: "task-1",
        title: "Stable title",
        description: "Stable description",
        status: "in-progress",
        userId: "assignee-2",
      });
    });

    expect(result.current).toBe(description);
    expect(renders).toBe(renderCount);
    queryClient.clear();
  });
});
