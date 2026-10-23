import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRescheduleWorkItem } from "./work-item-calendar-reschedule";

const updateWorkItem = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: updateWorkItem,
}));

const task = {
  id: "RM-1",
  version: 4,
  startDate: "2026-10-10",
  dueDate: "2026-10-14",
};
const scheduleKey = ["work-items", "project-1", "schedule", "workspace-1", ""];

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(scheduleKey, {
    columns: [{ tasks: [task, { id: "RM-2", dueDate: "2026-10-01" }] }],
    plannedTasks: [],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useRescheduleWorkItem("project-1"), {
    wrapper,
  });
  return { queryClient, result };
}

function cachedTask(queryClient: QueryClient, id: string) {
  const data = queryClient.getQueryData<{
    columns: Array<{ tasks: Array<Record<string, unknown>> }>;
  }>(scheduleKey);
  return data?.columns[0].tasks.find((entry) => entry.id === id);
}

beforeEach(() => {
  updateWorkItem.mockReset();
});

describe("useRescheduleWorkItem (VW-26)", () => {
  it("patches both dates with the item's version and moves the bar in the cache", async () => {
    updateWorkItem.mockResolvedValue({
      version: 5,
      startDate: "2026-10-13",
      dueDate: "2026-10-17",
    });
    const { queryClient, result } = setup();

    await act(async () => {
      await result.current.mutateAsync({ task, dayShift: 3 });
    });

    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "RM-1",
      version: 4,
      startDate: "2026-10-13",
      dueDate: "2026-10-17",
    });
    expect(cachedTask(queryClient, "RM-1")).toMatchObject({
      startDate: "2026-10-13",
      dueDate: "2026-10-17",
    });
    // Other items are untouched.
    expect(cachedTask(queryClient, "RM-2")).toMatchObject({
      dueDate: "2026-10-01",
    });
  });

  it("sends only the due date for an item that has no start date", async () => {
    updateWorkItem.mockResolvedValue({ version: 2, dueDate: "2026-10-04" });
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync({
        task: { id: "RM-2", version: 1, dueDate: "2026-10-01" },
        dayShift: 3,
      });
    });

    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "RM-2",
      version: 1,
      dueDate: "2026-10-04",
    });
  });

  it("snaps the bar back when the server refuses the change", async () => {
    updateWorkItem.mockImplementation(async () => {
      throw new Error("conflict");
    });
    const { queryClient, result } = setup();
    act(() => {
      result.current.mutate({ task, dayShift: 3 });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(cachedTask(queryClient, "RM-1")).toMatchObject({
      startDate: "2026-10-10",
      dueDate: "2026-10-14",
    });
  });
});
