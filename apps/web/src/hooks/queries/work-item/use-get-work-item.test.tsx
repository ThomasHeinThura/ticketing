import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { shouldRetryQuery } from "@/query-client";
import useGetWorkItem, {
  prefetchWorkItemDetail,
  WORK_ITEM_READ_REUSE_MS,
} from "./use-get-work-item";

const getWorkItem = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: (key: string) => getWorkItem(key),
}));
vi.mock("@/hooks/use-native-work-item-realtime", () => ({
  useNativeWorkItemRealtime: () => ({ status: "connecting" }),
}));

const item = { key: "WLP-1", title: "Fix the thing" };

/** The app's own defaults (`query-client/index.ts`): no refetch on mount, the retry policy. */
function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: shouldRetryQuery,
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useGetWorkItem", () => {
  beforeEach(() => {
    getWorkItem.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses the read the route (or the list's hover) started for this visit", async () => {
    getWorkItem.mockResolvedValue(item);
    const { queryClient, wrapper } = setup();
    // The hover (or the route's early read) finished before the screen mounted.
    prefetchWorkItemDetail(queryClient, "WLP-1");
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["work-items", "detail", "WLP-1"]),
      ).toEqual(item),
    );
    const { result } = renderHook(() => useGetWorkItem({ key: "WLP-1" }), {
      wrapper,
    });
    expect(result.current.data).toEqual(item);
    await act(async () => {
      await Promise.resolve();
    });
    // Before this change: 2 (`refetchOnMount: "always"` sent the finished read again).
    expect(getWorkItem).toHaveBeenCalledTimes(1);

    // A second prefetch of the same visit (a route preload, then the click) is not sent again.
    prefetchWorkItemDetail(queryClient, "WLP-1");
    expect(getWorkItem).toHaveBeenCalledTimes(1);
  });

  it("reads again when returning to an item within seconds, since changes after the screen closed were not watched", async () => {
    getWorkItem.mockResolvedValue(item);
    const { wrapper } = setup();
    const first = renderHook(() => useGetWorkItem({ key: "WLP-1" }), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.data).toEqual(item));
    first.unmount();
    renderHook(() => useGetWorkItem({ key: "WLP-1" }), { wrapper });
    await waitFor(() => expect(getWorkItem).toHaveBeenCalledTimes(2));
  });

  it("still reads again on mount when the cached copy is older than the visit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    getWorkItem.mockResolvedValue(item);
    const { queryClient, wrapper } = setup();
    await queryClient.fetchQuery({
      queryKey: ["work-items", "detail", "WLP-1"],
      queryFn: () => getWorkItem("WLP-1"),
    });
    vi.setSystemTime(Date.now() + WORK_ITEM_READ_REUSE_MS);
    renderHook(() => useGetWorkItem({ key: "WLP-1" }), { wrapper });
    await waitFor(() => expect(getWorkItem).toHaveBeenCalledTimes(2));
  });

  it("reads again on mount when realtime or a mutation marked the cached copy changed", async () => {
    getWorkItem.mockResolvedValue(item);
    const { queryClient, wrapper } = setup();
    await queryClient.fetchQuery({
      queryKey: ["work-items", "detail", "WLP-1"],
      queryFn: () => getWorkItem("WLP-1"),
    });
    await queryClient.invalidateQueries({
      queryKey: ["work-items", "detail", "WLP-1"],
    });
    renderHook(() => useGetWorkItem({ key: "WLP-1" }), { wrapper });
    await waitFor(() => expect(getWorkItem).toHaveBeenCalledTimes(2));
  });

  it("does not ask again for an unknown key refused moments ago, and does once that answer is old", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    getWorkItem.mockRejectedValue(
      new HttpError(404, "Failed to fetch work item"),
    );
    const { queryClient, wrapper } = setup();
    prefetchWorkItemDetail(queryClient, "NOPE-1");
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["work-items", "detail", "NOPE-1"])?.status,
      ).toBe("error"),
    );
    const first = renderHook(() => useGetWorkItem({ key: "NOPE-1" }), {
      wrapper,
    });
    expect(first.result.current.error).toBeInstanceOf(HttpError);
    // Before this change: 2 (the mount sent the refused read again).
    expect(getWorkItem).toHaveBeenCalledTimes(1);
    first.unmount();

    vi.setSystemTime(Date.now() + WORK_ITEM_READ_REUSE_MS);
    renderHook(() => useGetWorkItem({ key: "NOPE-1" }), { wrapper });
    await waitFor(() => expect(getWorkItem).toHaveBeenCalledTimes(2));
  });

  it("retries a dropped request after 1 s, as the retry policy says (#10)", async () => {
    vi.useFakeTimers();
    getWorkItem
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(item);
    const { wrapper } = setup();
    const { result } = renderHook(() => useGetWorkItem({ key: "WLP-1" }), {
      wrapper,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getWorkItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(getWorkItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getWorkItem).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual(item);
  });

  it("retries a dropped request in a prefetch after 1 s too, and the opened detail joins it", async () => {
    vi.useFakeTimers();
    getWorkItem
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(item);
    const { queryClient, wrapper } = setup();
    prefetchWorkItemDetail(queryClient, "WLP-1");
    const { result } = renderHook(() => useGetWorkItem({ key: "WLP-1" }), {
      wrapper,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getWorkItem).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual(item);
  });
});
