import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { HttpError } from "@/lib/http-error";
import useGetWorkItems from "./use-get-work-items";

const mocks = vi.hoisted(() => ({ list: vi.fn(), search: vi.fn() }));
vi.mock("@/fetchers/work-item/get-work-items", () => ({ default: mocks.list }));
vi.mock("@/fetchers/work-item/search-work-items", () => ({
  default: mocks.search,
}));

const page = (ids: string[], cursor: string | null): WorkItemsResult => ({
  items: ids.map((id) => ({ id }) as WorkItemsResult["items"][number]),
  hasPartialFailure: false,
  hasMore: Boolean(cursor),
  nextCursor: cursor,
});
const key = ["work-items", "p", "list", "key", "asc"];
const initial = () => ({
  pages: [
    page(["a", "b"], "c1"),
    page(["c", "d"], "c2"),
    page(["e", "f"], null),
  ],
  pageParams: [undefined, "c1", "c2"],
});
function setup(status: WorkItemRealtimeStatus = "unavailable", search = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  const searchKey = [
    "work-items",
    "p",
    "key",
    "asc",
    [{ field: "key", order: "asc" }],
    "search",
    "priority:high",
    "ws",
    null,
  ];
  const activeKey = search ? searchKey : key;
  client.setQueryData(activeKey, initial());
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  const view = renderHook(
    ({ realtimeStatus }) =>
      useGetWorkItems({
        projectId: "p",
        projectSlug: "P",
        workspaceId: "ws",
        sort: "key",
        dir: "asc",
        ...(search ? { filter: "priority:high" } : {}),
        realtimeStatus,
      }),
    { wrapper: Wrapper, initialProps: { realtimeStatus: status } },
  );
  return { client, activeKey, ...view };
}
async function advance(ms = 30_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.list.mockReset();
  mocks.search.mockReset();
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("work list fallback polling", () => {
  it("makes no interval requests while connected and clears its timer on unmount", async () => {
    const view = setup("available");
    await advance(90_000);
    expect(mocks.list).not.toHaveBeenCalled();
    view.rerender({ realtimeStatus: "unavailable" });
    mocks.list.mockResolvedValue(page(["a", "b"], "c1"));
    await advance();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    view.unmount();
    await advance(90_000);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "reads only page one and merges changes without disturbing later rows (search: %s)",
    async (search) => {
      const view = setup("connecting", search);
      const fetcher = search ? mocks.search : mocks.list;
      fetcher.mockResolvedValueOnce(page(["new", "c"], "new-cursor"));
      await advance();
      expect(fetcher).toHaveBeenCalledTimes(1);
      if (search)
        expect(fetcher).toHaveBeenCalledWith(
          expect.objectContaining({ cursor: undefined }),
        );
      else
        expect(fetcher).toHaveBeenCalledWith("p", "key", "asc", {
          cursor: undefined,
        });
      const data = view.client.getQueryData<ReturnType<typeof initial>>(
        view.activeKey,
      );
      expect(data?.pages.map((p) => p.items.map((item) => item.id))).toEqual([
        ["new", "c"],
        ["c", "d"],
        ["e", "f"],
      ]);
      expect(data?.pageParams).toEqual([undefined, "c1", "c2"]);
      await advance(10);
      expect(view.result.current.data?.items.map((item) => item.id)).toEqual([
        "new",
        "c",
        "d",
        "e",
        "f",
      ]);
      fetcher.mockResolvedValueOnce(page(["new", "b"], "newer"));
      await advance();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(
        view.client
          .getQueryData<ReturnType<typeof initial>>(view.activeKey)
          ?.pages.map((p) => p.items.map((i) => i.id)),
      ).toEqual([
        ["new", "b"],
        ["c", "d"],
        ["e", "f"],
      ]);
      await advance(10);
      expect(view.result.current.data?.items.map((item) => item.id)).toEqual([
        "new",
        "b",
        "c",
        "d",
        "e",
        "f",
      ]);
    },
  );

  it("keeps polling foreground only and discards responses after unmount", async () => {
    let resolve!: (value: WorkItemsResult) => void;
    mocks.list.mockReturnValue(
      new Promise<WorkItemsResult>((r) => {
        resolve = r;
      }),
    );
    const view = setup();
    focusManager.setFocused(false);
    await advance();
    expect(mocks.list).not.toHaveBeenCalled();
    focusManager.setFocused(true);
    await advance();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      resolve(page(["late"], null));
      await Promise.resolve();
    });
    expect(view.client.getQueryData(key)).toEqual(initial());
  });

  it("leaves manual refresh as a full traversal of loaded pages", async () => {
    const view = setup();
    mocks.list.mockImplementation(
      async (
        _project: string,
        _sort: string,
        _dir: string,
        options: { cursor?: string },
      ) =>
        options.cursor === "c1"
          ? page(["next"], "c2")
          : options.cursor === "c2"
            ? page(["last"], null)
            : page(["first"], "c1"),
    );
    await act(async () => {
      await view.result.current.refetch();
    });
    expect(mocks.list.mock.calls.map((call) => call[3].cursor)).toEqual([
      undefined,
      "c1",
      "c2",
    ]);
  });

  it("does not overwrite a newer cache update with an in-flight poll", async () => {
    let resolve!: (value: WorkItemsResult) => void;
    mocks.list.mockReturnValue(
      new Promise<WorkItemsResult>((r) => {
        resolve = r;
      }),
    );
    const view = setup();
    await advance();
    const updated = initial();
    updated.pages[1] = page(["changed"], "c2");
    act(() => {
      view.client.setQueryData(key, updated);
    });
    await act(async () => {
      resolve(page(["stale"], "c1"));
      await Promise.resolve();
    });
    expect(view.client.getQueryData(key)).toEqual(updated);
  });

  it("hides cached data after an authorization denial and recovers on a later poll", async () => {
    const view = setup();
    mocks.list
      .mockRejectedValueOnce(new HttpError(403, "denied"))
      .mockResolvedValueOnce(page(["allowed"], "c1"));
    await advance();
    await advance(10);
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isError).toBe(true);
    await advance(29_990);
    await advance(10);
    expect(view.result.current.data?.items[0]?.id).toBe("allowed");
  });
});
