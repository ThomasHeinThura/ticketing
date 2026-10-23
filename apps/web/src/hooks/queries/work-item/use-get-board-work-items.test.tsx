import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useGetBoardWorkItems from "./use-get-board-work-items";

const mocks = vi.hoisted(() => ({ list: vi.fn(), search: vi.fn() }));
vi.mock("@/fetchers/work-item/get-work-items", () => ({ default: mocks.list }));
vi.mock("@/fetchers/work-item/search-work-items", () => ({
  default: mocks.search,
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
const base = {
  projectId: "p1",
  projectSlug: "SERVICE",
  workspaceId: "ws1",
  realtimeStatus: "available" as const,
};
beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ items: [], hasMore: false });
  mocks.search.mockReset().mockResolvedValue({ items: [], hasMore: false });
});
afterEach(cleanup);

describe("canonical board server sorting", () => {
  it("requests the selected sort on every cursor page and starts a fresh cursor when it changes", async () => {
    mocks.list.mockImplementation((_project, sort, _dir, { cursor }) =>
      Promise.resolve({
        items: [{ key: `${sort}-${cursor ?? "first"}` }],
        hasMore: !cursor,
        nextCursor: cursor ? null : "page-2",
      }),
    );
    const { wrapper, client } = setup();
    const view = renderHook(
      ({ sort, dir }: { sort: "priority" | "dueDate"; dir: "asc" | "desc" }) =>
        useGetBoardWorkItems({ ...base, sort, dir }),
      { wrapper, initialProps: { sort: "priority", dir: "desc" } },
    );
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    await act(async () => {
      await view.result.current.fetchNextPage();
    });
    expect(mocks.list).toHaveBeenCalledWith("p1", "priority", "desc", {
      limit: 200,
      cursor: "page-2",
    });
    view.rerender({ sort: "dueDate", dir: "asc" });
    await waitFor(() =>
      expect(view.result.current.data?.pages[0].items).toEqual([
        { key: "dueDate-first" },
      ]),
    );
    expect(mocks.list).toHaveBeenLastCalledWith("p1", "dueDate", "asc", {
      limit: 200,
      cursor: undefined,
    });
    expect(
      client.getQueryCache().findAll({ queryKey: ["work-items", "p1"] }),
    ).toHaveLength(2);
  });

  it("sends supported structured sorts to search and never forwards an old cursor across direction changes", async () => {
    const { wrapper } = setup();
    const view = renderHook(
      ({ dir }: { dir: "asc" | "desc" }) =>
        useGetBoardWorkItems({
          ...base,
          filter: "priority = high",
          sort: "priority",
          dir,
        }),
      { wrapper, initialProps: { dir: "desc" } },
    );
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sort: "priority",
        dir: "desc",
        cursor: undefined,
      }),
    );
    view.rerender({ dir: "asc" });
    await waitFor(() =>
      expect(mocks.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sort: "priority",
          dir: "asc",
          cursor: undefined,
        }),
      ),
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("uses the documented key fallback when filtered rank order has no server equivalent", async () => {
    const { wrapper } = setup();
    const view = renderHook(
      () =>
        useGetBoardWorkItems({
          ...base,
          filter: "priority = high",
          sort: "position",
          dir: "desc",
        }),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "key", dir: "asc" }),
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
