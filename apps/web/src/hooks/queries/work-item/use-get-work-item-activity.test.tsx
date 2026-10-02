import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORK_ITEM_REFRESH_INTERVAL_MS } from "./use-get-work-item";
import useGetWorkItemActivity from "./use-get-work-item-activity";

const getWorkItemActivity = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/work-item/get-work-item-activity", () => ({
  default: (...args: unknown[]) => getWorkItemActivity(...args),
}));

function createTestClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, wrapper: Wrapper };
}

afterEach(() => {
  getWorkItemActivity.mockReset();
});

describe("useGetWorkItemActivity refresh", () => {
  it("refetches the active activity feed to observe another actor's comment", async () => {
    getWorkItemActivity
      .mockResolvedValueOnce({
        data: [],
        page: { hasMore: false, nextCursor: null },
      })
      .mockResolvedValueOnce({
        data: [{ id: "comment-1", body: "Added by another actor" }],
        page: { hasMore: false, nextCursor: null },
      });

    const { client, wrapper } = createTestClient();
    const { result } = renderHook(() => useGetWorkItemActivity("WLP-1"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.data?.pages[0]?.data).toEqual([]),
    );
    const activityQuery = client
      .getQueryCache()
      .find({ queryKey: ["work-items", "activity", "WLP-1"] });
    expect(
      (activityQuery?.options as { refetchInterval?: number } | undefined)
        ?.refetchInterval,
    ).toBe(WORK_ITEM_REFRESH_INTERVAL_MS);
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() =>
      expect(result.current.data?.pages[0]?.data).toEqual([
        { id: "comment-1", body: "Added by another actor" },
      ]),
    );
    expect(result.current.data?.pages[0]?.data).toEqual([
      { id: "comment-1", body: "Added by another actor" },
    ]);
    expect(getWorkItemActivity).toHaveBeenCalledTimes(2);
  });
});
