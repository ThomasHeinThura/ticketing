import {
  focusManager,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { HttpError } from "@/lib/http-error";
import useGetWorkItems from "./use-get-work-items";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
  unauthorized: vi.fn(),
}));
vi.mock("@/lib/http-error", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http-error")>()),
  handleUnauthorized: mocks.unauthorized,
}));

import productionClient, { portalSessionQueryKey } from "@/query-client";

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
function setup(
  status: WorkItemRealtimeStatus = "unavailable",
  search = false,
  options: {
    cached?: ReturnType<typeof initial>;
    cache?: QueryCache;
    client?: QueryClient;
    selected?: string[];
    sort?: "key" | "title";
  } = {},
) {
  const client =
    options.client ??
    new QueryClient({
      queryCache: options.cache,
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
  const sort = options.sort ?? "key";
  const selectedKey =
    sort === "key" ? activeKey : ["work-items", "p", "list", sort, "asc"];
  client.setQueryData(selectedKey, options.cached ?? initial());
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  const view = renderHook(
    ({ realtimeStatus }) => {
      const [selected, setSelected] = useState(options.selected ?? []);
      const query = useGetWorkItems({
        projectId: "p",
        projectSlug: "P",
        workspaceId: "ws",
        sort,
        dir: "asc",
        ...(search ? { filter: "priority:high" } : {}),
        realtimeStatus,
      });
      useEffect(() => {
        if (query.data) {
          const present = new Set(query.data.items.map((item) => item.id));
          setSelected((current) => current.filter((id) => present.has(id)));
        }
      }, [query.data]);
      return { ...query, selected };
    },
    { wrapper: Wrapper, initialProps: { realtimeStatus: status } },
  );
  return { client, activeKey: selectedKey, ...view };
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
    "reads one page when membership and cursor are unchanged (search: %s)",
    async (search) => {
      const view = setup("connecting", search);
      const fetcher = search ? mocks.search : mocks.list;
      fetcher.mockResolvedValue(page(["a", "b"], "c1"));
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
      expect(view.client.getQueryData(view.activeKey)).toEqual(initial());
    },
  );

  it.each([
    {
      name: "insert at top",
      ordered: ["new", "a", "b", "c", "d", "e", "f", "g", "h"],
      selected: ["b", "f"],
      expected: [
        ["new", "a"],
        ["b", "c"],
        ["d", "e"],
        ["f", "g"],
      ],
    },
    {
      name: "delete on page one",
      ordered: ["b", "c", "d", "e", "f", "g", "h"],
      selected: ["a", "b"],
      expected: [
        ["b", "c"],
        ["d", "e"],
        ["f", "g"],
      ],
    },
    {
      name: "move page one to page two",
      ordered: ["b", "c", "a", "d", "e", "f", "g", "h"],
      selected: ["a", "c"],
      expected: [
        ["b", "c"],
        ["a", "d"],
        ["e", "f"],
      ],
    },
    {
      name: "move page two to page one",
      ordered: ["c", "a", "b", "d", "e", "f", "g", "h"],
      selected: ["b", "c"],
      expected: [
        ["c", "a"],
        ["b", "d"],
        ["e", "f"],
      ],
    },
  ])(
    "reconciles $name without transiently pruning retained selection",
    async ({ ordered, selected, expected, name }) => {
      const cached = {
        pages: [
          page(["a", "b"], "after:b"),
          page(["c", "d"], "after:d"),
          page(["e", "f"], "after:f"),
        ],
        pageParams: [undefined, "after:b", "after:d"],
      };
      const view = setup("unavailable", false, {
        cached,
        selected,
        sort: "title",
      });
      mocks.list.mockImplementation(
        async (
          _p: string,
          _s: string,
          _d: string,
          { cursor }: { cursor?: string },
        ) => {
          const start = cursor ? ordered.indexOf(cursor.slice(6)) + 1 : 0;
          if (cursor && start === 0) throw new Error("invalid cursor");
          const items = ordered.slice(start, start + 2);
          return page(
            items,
            start + 2 < ordered.length ? `after:${items.at(-1)}` : null,
          );
        },
      );
      await advance();
      await advance(10);
      const data = view.client.getQueryData<ReturnType<typeof initial>>(
        view.activeKey,
      );
      expect(data?.pages.map((p) => p.items.map((item) => item.id))).toEqual(
        expected,
      );
      expect(
        new Set(data?.pages.flatMap((p) => p.items.map((i) => i.id))).size,
      ).toBe(data?.pages.flatMap((p) => p.items).length);
      expect(view.result.current.selected).toEqual(
        name === "delete on page one" ? ["b"] : selected,
      );
      expect(mocks.list.mock.calls.map((call) => call[3].cursor)).toEqual(
        data?.pageParams,
      );
      if (name === "insert at top") {
        await act(async () => {
          await view.result.current.fetchNextPage();
        });
        expect(mocks.list.mock.calls.at(-1)?.[3].cursor).toBe("after:g");
      }
    },
  );

  it("keeps the old rows and selection visible until boundary reconciliation completes", async () => {
    let resolve!: (value: WorkItemsResult) => void;
    const pending = new Promise<WorkItemsResult>((r) => {
      resolve = r;
    });
    const view = setup("unavailable", false, { selected: ["b"] });
    mocks.list
      .mockResolvedValueOnce(page(["new", "a"], "after:a"))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(page(["d", "e"], "after:e"))
      .mockResolvedValueOnce(page(["f"], null));
    await advance();
    expect(view.client.getQueryData(key)).toEqual(initial());
    expect(view.result.current.selected).toEqual(["b"]);
    await act(async () => {
      resolve(page(["b", "c"], "after:c"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(
      view.client
        .getQueryData<ReturnType<typeof initial>>(key)
        ?.pages.map((p) => p.items.map((item) => item.id)),
    ).toEqual([["new", "a"], ["b", "c"], ["d", "e"], ["f"]]);
    expect(view.result.current.selected).toEqual(["b"]);
  });

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

  it("uses the production cache's session removal and unauthorized redirect on a polling 401", async () => {
    productionClient.clear();
    mocks.unauthorized.mockClear();
    productionClient.setQueryData(portalSessionQueryKey, { person: "cached" });
    mocks.list.mockRejectedValue(new HttpError(401, "signed out"));
    const view = setup("unavailable", false, { client: productionClient });
    await advance();
    await advance(10);
    expect(
      productionClient.getQueryData(portalSessionQueryKey),
    ).toBeUndefined();
    expect(mocks.unauthorized).toHaveBeenCalledTimes(1);
    expect(view.result.current.data).toBeUndefined();
    await advance(90_000);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    view.unmount();
    productionClient.clear();
  });

  it.each([401, 403])(
    "routes %s polling failures through the same cache callback as normal fetches",
    async (status) => {
      const onError = vi.fn();
      const cache = new QueryCache({ onError });
      const view = setup("unavailable", false, { cache });
      const error = new HttpError(status, "denied");
      mocks.list.mockRejectedValue(error);
      await advance();
      await advance(10);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]).toBe(error);
      expect(view.result.current.data).toBeUndefined();
      expect(view.result.current.error).toBe(error);
      await advance(90_000);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      view.unmount();

      const normalError = vi.fn();
      const normal = setup("available", false, {
        cache: new QueryCache({ onError: normalError }),
      });
      await act(async () => {
        await normal.result.current.refetch();
      });
      await advance(10);
      expect(normalError).toHaveBeenCalledTimes(1);
      expect(normalError.mock.calls[0]?.[0]).toBe(error);
      expect(normal.result.current.data).toBeUndefined();
      expect(normal.result.current.error).toBe(error);
    },
  );
});
