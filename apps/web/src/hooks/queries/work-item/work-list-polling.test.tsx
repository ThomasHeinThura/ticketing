import {
  focusManager,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { type ReactNode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkListChangedNotice from "@/components/work-item/work-list-changed-notice";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { HttpError } from "@/lib/http-error";
import useGetWorkItems from "./use-get-work-items";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "workItems:listChanged" ? "This list has changed." : "Refresh",
  }),
}));

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
    cold?: boolean;
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
  if (!options.cold)
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
  it.each(["leave", "join"] as const)(
    "waits for a pending local edit before probing a filtered %s",
    async (membership) => {
      const view = setup("unavailable", true);
      view.client.setQueryData(["work-items", "detail", "P-1"], {
        key: "P-1",
        projectId: "p",
      });
      let resolve!: () => void;
      const request = new Promise<void>((done) => {
        resolve = done;
      });
      const mutation = view.client.getMutationCache().build(view.client, {
        mutationKey: ["work-items", "mutate", "P-1"],
        mutationFn: () => request,
      });
      void mutation.execute(undefined);
      const result =
        membership === "leave"
          ? page(["b"], "c1")
          : page(["a", "b", "new"], "c1");
      mocks.search.mockResolvedValue(result);
      await advance();
      expect(mocks.search).not.toHaveBeenCalled();
      expect(view.result.current.hasNewerChanges).toBe(false);
      resolve();
      await act(async () => {
        await request;
      });
      await advance();
      expect(mocks.search).toHaveBeenCalledTimes(1);
      expect(view.result.current.hasNewerChanges).toBe(true);
    },
  );

  it("discards a probe when a local edit starts and settles during the request", async () => {
    const view = setup("unavailable", true);
    view.client.setQueryData(["work-items", "detail", "P-1"], {
      key: "P-1",
      projectId: "p",
    });
    let resolveProbe!: (value: WorkItemsResult) => void;
    mocks.search.mockReturnValue(
      new Promise<WorkItemsResult>((resolve) => {
        resolveProbe = resolve;
      }),
    );
    await advance();
    const mutation = view.client.getMutationCache().build(view.client, {
      mutationKey: ["work-items", "mutate", "P-1"],
      mutationFn: async () => undefined,
    });
    await act(async () => {
      await mutation.execute(undefined);
    });
    await act(async () => {
      resolveProbe(page(["new"], null));
    });
    await advance(10);
    expect(view.result.current.hasNewerChanges).toBe(false);
  });

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
          signal: expect.any(AbortSignal),
        });
      expect(view.client.getQueryData(view.activeKey)).toEqual(initial());
      expect(view.result.current.hasNewerChanges).toBe(false);
    },
  );

  it.each([false, true])(
    "makes one request per tick and preserves every cached row and selection on five arrivals (search: %s)",
    async (search) => {
      const view = setup("unavailable", search, { selected: ["a", "d", "f"] });
      const fetcher = search ? mocks.search : mocks.list;
      fetcher.mockResolvedValue(page(["n1", "n2", "n3", "n4", "n5"], "next"));
      await advance();
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(view.client.getQueryData(view.activeKey)).toEqual(initial());
      expect(view.result.current.selected).toEqual(["a", "d", "f"]);
      expect(view.result.current.hasNewerChanges).toBe(true);
      await advance(29_990);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(view.client.getQueryData(view.activeKey)).toEqual(initial());
      expect(view.result.current.selected).toEqual(["a", "d", "f"]);
    },
  );

  it("does not retry a failed request within the same interval", async () => {
    const onError = vi.fn();
    const view = setup("unavailable", false, {
      cache: new QueryCache({ onError }),
    });
    mocks.list.mockRejectedValue(new Error("offline"));
    await advance();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await advance(29_999);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(view.client.getQueryData(key)).toEqual(initial());
  });

  it.each([false, true])(
    "detects a page-one field change without mutating any of three pages (search: %s)",
    async (search) => {
      const cached = initial();
      const view = setup("unavailable", search, {
        cached,
        selected: ["c", "f"],
      });
      const updated = page(["a", "b"], "c1");
      updated.items[0] = { ...updated.items[0], title: "updated" };
      const fetcher = search ? mocks.search : mocks.list;
      fetcher.mockResolvedValue(updated);
      await advance();
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(view.client.getQueryData(view.activeKey)).toBe(cached);
      expect(view.client.getQueryData(view.activeKey)).toEqual(initial());
      expect(view.result.current.selected).toEqual(["c", "f"]);
      expect(view.result.current.hasNewerChanges).toBe(true);
    },
  );

  it.each([false, true])(
    "recovers a failed cold read with one request per tick (search: %s)",
    async (search) => {
      const fetcher = search ? mocks.search : mocks.list;
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            retry: (_count, error) => error.message !== "unavailable",
            retryDelay: 10,
          },
        },
      });
      fetcher.mockRejectedValueOnce(new HttpError(500, "unavailable"));
      fetcher.mockRejectedValueOnce(new HttpError(500, "still unavailable"));
      fetcher.mockResolvedValue(page(["recovered"], null));
      const view = setup("unavailable", search, { cold: true, client });
      await advance(10);
      expect(view.result.current.isError).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await advance(29_990);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await advance(29_999);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await advance(1);
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(view.result.current.data?.items.map((item) => item.id)).toEqual([
        "recovered",
      ]);
      expect(view.result.current.hasNewerChanges).toBe(false);
    },
  );

  it.each([false, true])(
    "lets an in-flight cold recovery finish when realtime connects before it resolves (search: %s)",
    async (search) => {
      const fetcher = search ? mocks.search : mocks.list;
      let resolve!: (value: WorkItemsResult) => void;
      fetcher
        .mockRejectedValueOnce(new HttpError(500, "unavailable"))
        .mockReturnValueOnce(
          new Promise<WorkItemsResult>((r) => {
            resolve = r;
          }),
        );
      const view = setup("unavailable", search, { cold: true });
      await advance(10);
      expect(view.result.current.isError).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);

      await advance(29_990);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const signal: AbortSignal = search
        ? fetcher.mock.calls[1]?.[0].signal
        : fetcher.mock.calls[1]?.[3].signal;
      expect(signal.aborted).toBe(false);

      view.rerender({ realtimeStatus: "available" });
      expect(signal.aborted).toBe(false);

      await act(async () => {
        resolve(page(["recovered"], null));
        await Promise.resolve();
      });
      await advance(90_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(view.result.current.isError).toBe(false);
      expect(view.result.current.data?.items.map((item) => item.id)).toEqual([
        "recovered",
      ]);
      expect(view.result.current.hasNewerChanges).toBe(false);
    },
  );

  it("aborts a cold recovery on unmount and ignores a late result", async () => {
    let resolve!: (value: WorkItemsResult) => void;
    mocks.list
      .mockRejectedValueOnce(new HttpError(500, "unavailable"))
      .mockReturnValueOnce(
        new Promise<WorkItemsResult>((r) => {
          resolve = r;
        }),
      );
    const view = setup("unavailable", false, { cold: true });
    await advance(30_000);
    const signal: AbortSignal = mocks.list.mock.calls[1]?.[3].signal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(page(["late"], null));
      await Promise.resolve();
    });
    await advance(90_000);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(view.client.getQueryData(key)).toBeUndefined();
  });

  it("aborts a cold search recovery when the filter changes", async () => {
    let resolve!: (value: WorkItemsResult) => void;
    mocks.search
      .mockRejectedValueOnce(new HttpError(500, "unavailable"))
      .mockReturnValueOnce(
        new Promise<WorkItemsResult>((r) => {
          resolve = r;
        }),
      )
      .mockResolvedValue(page(["new-filter"], null));
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(
      ({ filter }) =>
        useGetWorkItems({
          projectId: "p",
          projectSlug: "P",
          workspaceId: "ws",
          filter,
          sort: "key",
          dir: "asc",
          realtimeStatus: "unavailable",
        }),
      { wrapper, initialProps: { filter: "priority:high" } },
    );
    await advance(30_000);
    const signal: AbortSignal = mocks.search.mock.calls[1]?.[0].signal;
    view.rerender({ filter: "priority:low" });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(page(["late"], null));
      await Promise.resolve();
    });
    await advance(10);
    expect(mocks.search).toHaveBeenCalledTimes(3);
    expect(view.result.current.data?.items.map((item) => item.id)).toEqual([
      "new-filter",
    ]);
    expect(view.result.current.hasNewerChanges).toBe(false);
  });

  it("stops cold recovery after an access denial", async () => {
    mocks.list
      .mockRejectedValueOnce(new HttpError(500, "unavailable"))
      .mockRejectedValueOnce(new HttpError(403, "denied"));
    const view = setup("unavailable", false, { cold: true });
    await advance(30_010);
    expect(view.result.current.error).toBeInstanceOf(HttpError);
    await advance(90_000);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(view.result.current.data).toBeUndefined();
  });

  it("shows one polite notice with a keyboard reachable refresh that performs a full refresh", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    client.setQueryData(key, initial());
    function Harness() {
      const list = useGetWorkItems({
        projectId: "p",
        sort: "key",
        dir: "asc",
        realtimeStatus: "unavailable",
      });
      const [selected, setSelected] = useState(["d", "f"]);
      useEffect(() => {
        if (list.data) {
          const ids = new Set(list.data.items.map((i) => i.id));
          setSelected((old) => old.filter((id) => ids.has(id)));
        }
      }, [list.data]);
      return (
        <>
          <span data-testid="selected">{selected.join(",")}</span>
          {list.hasNewerChanges ? (
            <WorkListChangedNotice
              onRefresh={() => void list.refreshChangedList()}
            />
          ) : null}
        </>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    mocks.list.mockResolvedValueOnce(
      page(["n1", "n2", "n3", "n4", "n5"], "new"),
    );
    await advance();
    await advance(10);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(notice).toHaveTextContent("This list has changed.");
    expect(screen.getByTestId("selected")).toHaveTextContent("d,f");
    const refresh = screen.getByRole("button", { name: "Refresh" });
    refresh.focus();
    expect(document.activeElement).toBe(refresh);
    mocks.list.mockImplementation(
      async (
        _p: string,
        _s: string,
        _d: string,
        options: { cursor?: string },
      ) =>
        options.cursor === "c1"
          ? page(["c", "d"], "c2")
          : options.cursor === "c2"
            ? page(["e", "f"], null)
            : page(["a", "b"], "c1"),
    );
    await act(async () => {
      fireEvent.click(refresh);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(
      screen.queryByText("This list has changed."),
    ).not.toBeInTheDocument();
    expect(
      mocks.list.mock.calls.slice(1).map((call) => call[3].cursor),
    ).toEqual([undefined, "c1", "c2"]);
    expect(screen.getByTestId("selected")).toHaveTextContent("d,f");
  });

  it("clears the flag on reconnect and sends no connected polls", async () => {
    const view = setup();
    mocks.list.mockResolvedValue(page(["new"], null));
    await advance();
    await advance(10);
    expect(view.result.current.hasNewerChanges).toBe(true);
    view.rerender({ realtimeStatus: "available" });
    expect(view.result.current.hasNewerChanges).toBe(false);
    await advance(90_000);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending poll on reconnect and ignores a late response", async () => {
    let resolve!: (value: WorkItemsResult) => void;
    mocks.list.mockReturnValue(
      new Promise<WorkItemsResult>((r) => {
        resolve = r;
      }),
    );
    const view = setup();
    await advance();
    const signal: AbortSignal = mocks.list.mock.calls[0]?.[3].signal;
    view.rerender({ realtimeStatus: "available" });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(page(["late"], null));
      await Promise.resolve();
    });
    await advance(90_000);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(view.client.getQueryData(key)).toEqual(initial());
    expect(view.result.current.hasNewerChanges).toBe(false);
  });

  it("aborts an in-flight filtered poll on filter change and never writes its result", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
          gcTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    const searchKey = (filter: string) => [
      "work-items",
      "p",
      "key",
      "asc",
      [{ field: "key", order: "asc" }],
      "search",
      filter,
      "ws",
      null,
    ];
    client.setQueryData(searchKey("priority:high"), initial());
    client.setQueryData(searchKey("priority:low"), initial());
    let resolve!: (value: WorkItemsResult) => void;
    mocks.search.mockResolvedValueOnce(page(["new"], null)).mockReturnValueOnce(
      new Promise<WorkItemsResult>((r) => {
        resolve = r;
      }),
    );
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    const view = renderHook(
      ({ filter }) =>
        useGetWorkItems({
          projectId: "p",
          projectSlug: "P",
          workspaceId: "ws",
          filter,
          sort: "key",
          dir: "asc",
          realtimeStatus: "unavailable",
        }),
      { wrapper: Wrapper, initialProps: { filter: "priority:high" } },
    );
    await advance();
    await advance(10);
    expect(view.result.current.hasNewerChanges).toBe(true);
    await advance(29_990);
    const signal: AbortSignal = mocks.search.mock.calls[1]?.[0].signal;
    expect(signal.aborted).toBe(false);
    view.rerender({ filter: "priority:low" });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(page(["late"], null));
      await Promise.resolve();
    });
    expect(client.getQueryData(searchKey("priority:high"))).toEqual(initial());
    expect(client.getQueryData(searchKey("priority:low"))).toEqual(initial());
    expect(view.result.current.hasNewerChanges).toBe(false);
    expect(mocks.search).toHaveBeenCalledTimes(2);
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
    const signal: AbortSignal = mocks.list.mock.calls[0]?.[3].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(page(["late"], null));
      await Promise.resolve();
    });
    expect(view.client.getQueryData(key)).toEqual(initial());
    await advance(90_000);
    expect(mocks.list).toHaveBeenCalledTimes(1);
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

  it.each([false, true])(
    "ignores clock-only SLA fields across three ticks and again after Refresh with one request per tick (search: %s)",
    async (search) => {
      const makeRow = (sla: {
        metric: "first_response" | "resolution";
        state: "ok" | "at_risk" | "breached" | "met" | "missed";
        dueAt: string | null;
        remainingMinutes: number | null;
        consumedPct: number;
      }) =>
        ({
          id: "a",
          projectId: "p",
          number: 1,
          key: "P-1",
          title: "Investigate outage",
          stateId: "s-open",
          stateName: "In progress",
          stateCategory: "started",
          priority: "high" as const,
          assigneeId: "person-1",
          assigneeName: "Alice",
          assigneeActive: true,
          assigneeOnProject: true,
          blockedByOpenCount: 0,
          labels: [
            { id: "l-2", name: "Urgent", color: "#f00" },
            { id: "l-1", name: "Backend", color: "#00f" },
          ],
          dueDate: "2026-11-20T00:00:00.000Z",
          archivedAt: null,
          deletedAt: null,
          unavailableFields: [],
          customFieldValues: {
            tier: "gold",
            constructor: { rank: 1, tag: "x" },
          },
          version: 4,
          updatedAt: "2026-11-12T10:00:00.000Z",
          sla,
        }) as unknown as WorkItemsResult["items"][number];

      const makeFirstPage = (
        remainingMinutes: number,
        consumedPct: number,
        dueAt: string,
      ): WorkItemsResult => ({
        items: [
          makeRow({
            metric: "resolution",
            state: "ok",
            dueAt,
            remainingMinutes,
            consumedPct,
          }),
        ],
        hasPartialFailure: false,
        hasMore: true,
        nextCursor: "c1",
      });

      const cached = {
        pages: [
          makeFirstPage(45, 25, "2026-11-12T12:00:00.000Z"),
          page(["c", "d"], null),
        ],
        pageParams: [undefined, "c1"],
      };
      const view = setup("unavailable", search, { cached });
      const fetcher = search ? mocks.search : mocks.list;

      fetcher
        .mockResolvedValueOnce(
          makeFirstPage(40, 33, "2026-11-12T12:05:00.000Z"),
        )
        .mockResolvedValueOnce(
          makeFirstPage(35, 42, "2026-11-12T12:10:00.000Z"),
        )
        .mockResolvedValueOnce(
          makeFirstPage(30, 50, "2026-11-12T12:15:00.000Z"),
        );

      await advance();
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(view.result.current.hasNewerChanges).toBe(false);
      expect(view.client.getQueryData(view.activeKey)).toBe(cached);

      await advance(29_990);
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(view.result.current.hasNewerChanges).toBe(false);
      expect(view.client.getQueryData(view.activeKey)).toBe(cached);

      await advance(29_990);
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(view.result.current.hasNewerChanges).toBe(false);
      expect(view.client.getQueryData(view.activeKey)).toBe(cached);

      // Press Refresh (refetches both loaded pages with updated clock values), then poll across three more ticks.
      fetcher
        .mockResolvedValueOnce(
          makeFirstPage(28, 53, "2026-11-12T12:15:00.000Z"),
        )
        .mockResolvedValueOnce(page(["c", "d"], null))
        .mockResolvedValueOnce(
          makeFirstPage(22, 63, "2026-11-12T12:20:00.000Z"),
        )
        .mockResolvedValueOnce(
          makeFirstPage(16, 70, "2026-11-12T12:25:00.000Z"),
        )
        .mockResolvedValueOnce(
          makeFirstPage(12, 74, "2026-11-12T12:30:00.000Z"),
        );

      await act(async () => {
        await view.result.current.refreshChangedList();
      });
      expect(fetcher).toHaveBeenCalledTimes(5);
      expect(view.result.current.hasNewerChanges).toBe(false);
      const cachedAfterRefresh = view.client.getQueryData(view.activeKey);

      await advance(29_990);
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(6);
      expect(view.result.current.hasNewerChanges).toBe(false);
      expect(view.client.getQueryData(view.activeKey)).toBe(cachedAfterRefresh);

      await advance(29_990);
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(7);
      expect(view.result.current.hasNewerChanges).toBe(false);
      expect(view.client.getQueryData(view.activeKey)).toBe(cachedAfterRefresh);

      await advance(29_990);
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(8);
      expect(view.result.current.hasNewerChanges).toBe(false);
      expect(view.client.getQueryData(view.activeKey)).toBe(cachedAfterRefresh);
    },
  );

  it.each([false, true])(
    "raises the notice when SLA state crosses ok -> at_risk and at_risk -> breached without mutating cached pages (search: %s)",
    async (search) => {
      const makePage = (
        state: "ok" | "at_risk" | "breached",
      ): WorkItemsResult => ({
        items: [
          {
            id: "a",
            projectId: "p",
            number: 1,
            key: "P-1",
            title: "Investigate outage",
            stateId: "s-open",
            stateName: "In progress",
            stateCategory: "started",
            priority: "high" as const,
            unavailableFields: [],
            version: 4,
            updatedAt: "2026-11-12T10:00:00.000Z",
            sla: {
              metric: "resolution" as const,
              state,
              dueAt: "2026-11-12T12:00:00.000Z",
              remainingMinutes: 15,
              consumedPct: 75,
            },
          } as unknown as WorkItemsResult["items"][number],
        ],
        hasPartialFailure: false,
        hasMore: true,
        nextCursor: "c1",
      });

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
      const cached = {
        pages: [makePage("ok"), page(["c", "d"], null)],
        pageParams: [undefined, "c1"],
      };
      client.setQueryData(activeKey, cached);

      let latest!: ReturnType<typeof useGetWorkItems>;
      function Harness() {
        const list = useGetWorkItems({
          projectId: "p",
          projectSlug: "P",
          workspaceId: "ws",
          ...(search ? { filter: "priority:high" } : {}),
          sort: "key",
          dir: "asc",
          realtimeStatus: "unavailable",
        });
        latest = list;
        return list.hasNewerChanges ? (
          <WorkListChangedNotice
            onRefresh={() => void list.refreshChangedList()}
          />
        ) : null;
      }

      render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
      const fetcher = search ? mocks.search : mocks.list;

      // Tick 1: ok -> at_risk raises the notice without touching cached pages.
      fetcher.mockResolvedValueOnce(makePage("at_risk"));
      await advance();
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(latest.hasNewerChanges).toBe(true);
      expect(client.getQueryData(activeKey)).toBe(cached);

      // Press Refresh to load the updated pages and clear hasNewerChanges.
      fetcher
        .mockResolvedValueOnce(makePage("at_risk"))
        .mockResolvedValueOnce(page(["c", "d"], null));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(latest.hasNewerChanges).toBe(false);
      const cachedAfterRefresh = client.getQueryData(activeKey);
      expect(cachedAfterRefresh).toBeDefined();

      // Later tick: at_risk -> breached raises the notice again with one request and leaves cached pages untouched.
      fetcher.mockResolvedValueOnce(makePage("breached"));
      await advance(29_980);
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(latest.hasNewerChanges).toBe(true);
      expect(client.getQueryData(activeKey)).toBe(cachedAfterRefresh);
    },
  );

  it.each([
    { label: "null to present", fromPresent: false, search: false },
    { label: "null to present", fromPresent: false, search: true },
    { label: "present to null", fromPresent: true, search: false },
    { label: "present to null", fromPresent: true, search: true },
  ])(
    "raises the notice when a row's SLA badge goes from $label (search: $search)",
    async ({ fromPresent, search }) => {
      const badge = {
        metric: "resolution" as const,
        state: "ok" as const,
        dueAt: "2026-11-12T12:00:00.000Z",
        remainingMinutes: 45,
        consumedPct: 25,
      };
      const makePage = (sla: typeof badge | null): WorkItemsResult => ({
        items: [
          {
            id: "a",
            projectId: "p",
            number: 1,
            key: "P-1",
            title: "Investigate outage",
            unavailableFields: [],
            version: 4,
            updatedAt: "2026-11-12T10:00:00.000Z",
            sla,
          } as unknown as WorkItemsResult["items"][number],
        ],
        hasPartialFailure: false,
        hasMore: true,
        nextCursor: "c1",
      });

      const cached = {
        pages: [makePage(fromPresent ? badge : null), page(["c", "d"], null)],
        pageParams: [undefined, "c1"],
      };
      const view = setup("unavailable", search, { cached });
      const fetcher = search ? mocks.search : mocks.list;

      fetcher.mockResolvedValueOnce(makePage(fromPresent ? null : badge));
      await advance();
      await advance(10);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(view.result.current.hasNewerChanges).toBe(true);
      expect(view.client.getQueryData(view.activeKey)).toBe(cached);
    },
  );

  it.each([
    {
      label: "referenced custom-field person rename",
      mutate: (next: WorkItemsResult) => ({
        ...next,
        customFieldPeople: [
          { projectId: "p", personId: "person-2", name: "Bob" },
          { projectId: "p", personId: "person-1", name: "Alice Rivera" },
        ],
      }),
    },
    {
      label: "custom-field option label change",
      mutate: (next: WorkItemsResult) => ({
        ...next,
        customFieldColumns: [
          {
            key: "tier",
            name: "Support tier",
            format: "select" as const,
            options: [{ key: "gold", label: "Enterprise Gold" }],
          },
          {
            key: "owner",
            name: "Escalation owner",
            format: "user" as const,
            options: [],
          },
        ],
      }),
    },
  ])(
    "shows the notice when page-one envelope metadata changes ($label) with identical items",
    async ({ mutate }) => {
      const basePage: WorkItemsResult = {
        items: [
          {
            id: "a",
            projectId: "p",
            number: 1,
            key: "P-1",
            title: "Customer ticket",
            unavailableFields: [],
            customFieldValues: { tier: "gold", owner: "person-1" },
          } as unknown as WorkItemsResult["items"][number],
        ],
        hasPartialFailure: false,
        hasMore: true,
        nextCursor: "c1",
        customFieldColumns: [
          {
            key: "owner",
            name: "Escalation owner",
            format: "user",
            options: [],
          },
          {
            key: "tier",
            name: "Support tier",
            format: "select",
            options: [{ key: "gold", label: "Gold" }],
          },
        ],
        customFieldPeople: [
          { projectId: "p", personId: "person-1", name: "Alice" },
          { projectId: "p", personId: "person-2", name: "Bob" },
        ],
      };
      const cached = {
        pages: [basePage, page(["c", "d"], null)],
        pageParams: [undefined, "c1"],
      };
      const view = setup("unavailable", true, { cached });

      // Reordered customFieldColumns / customFieldPeople with identical values produce no false notice.
      mocks.search.mockResolvedValueOnce({
        ...basePage,
        customFieldColumns: [...(basePage.customFieldColumns ?? [])].reverse(),
        customFieldPeople: [...(basePage.customFieldPeople ?? [])].reverse(),
      });
      await advance();
      await advance(10);
      expect(mocks.search).toHaveBeenCalledTimes(1);
      expect(view.result.current.hasNewerChanges).toBe(false);
      expect(view.client.getQueryData(view.activeKey)).toBe(cached);

      // Renaming a referenced person or option label on page one raises the notice without writing to cache.
      mocks.search.mockResolvedValueOnce(mutate(basePage));
      await advance(29_990);
      await advance(10);
      expect(mocks.search).toHaveBeenCalledTimes(2);
      expect(view.result.current.hasNewerChanges).toBe(true);
      expect(view.client.getQueryData(view.activeKey)).toBe(cached);
    },
  );
});
