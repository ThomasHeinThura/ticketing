import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useGetCommentVersionHistory from "./use-get-comment-version-history";

const mocks = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock("@/fetchers/work-item/get-comment-version-page", () => ({
  default: mocks.getPage,
}));

const page = (numbers: number[]) => ({
  data: numbers.map((number) => ({
    number,
    body: `v${number}`,
    editedBy: null,
    createdAt: "2026-10-12T00:00:00.000Z",
  })),
  page: { nextCursor: null, hasMore: false },
});

describe("useGetCommentVersionHistory", () => {
  beforeEach(() => {
    mocks.getPage.mockReset();
  });

  it("refetches an invalidated history on remount despite the app default refetchOnMount:false", async () => {
    // Same defaults as apps/web/src/query-client/index.ts.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const args = { key: "WI-1", commentId: "c1", enabled: true };

    mocks.getPage.mockResolvedValueOnce(page([1, 2]));
    const first = renderHook(() => useGetCommentVersionHistory(args), {
      wrapper,
    });
    await waitFor(() =>
      expect(first.result.current.data?.pages[0].data).toHaveLength(2),
    );
    first.unmount();

    // An edit lands while the history control is unmounted.
    await queryClient.invalidateQueries({
      queryKey: ["work-items", "comment-versions", "WI-1", "c1"],
    });
    mocks.getPage.mockResolvedValueOnce(page([1, 2, 3]));
    const second = renderHook(() => useGetCommentVersionHistory(args), {
      wrapper,
    });
    await waitFor(() =>
      expect(second.result.current.data?.pages[0].data).toHaveLength(3),
    );
    expect(mocks.getPage).toHaveBeenCalledTimes(2);
  });

  it("requests the first page lazily only when enabled", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnMount: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useGetCommentVersionHistory({ key: "WI-1", commentId: "c1", enabled }),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(mocks.getPage).not.toHaveBeenCalled();
    mocks.getPage.mockResolvedValueOnce(page([1]));
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mocks.getPage).toHaveBeenCalledTimes(1);
  });
});
