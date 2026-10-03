import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
