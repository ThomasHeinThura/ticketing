import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import useGetWorkItems from "./use-get-work-items";

/**
 * A fresh, independent review of #310's client absorption caught a real bug here: the
 * first version of this hook used a bare `placeholderData: keepPreviousData`, which
 * reuses the previous QUERY's result across ANY key change -- including a `projectId`
 * switch. Reproduced live: navigating from project A to project B left `isLoading:
 * false` and `data` still holding A's rows (`isPlaceholderData: true`) until B's fetch
 * resolved, and `work.tsx` rendered A's rows under B's page with no guard. This file
 * proves both halves of the fix with a REAL `QueryClient` (not a mocked query state):
 * same-project sort changes still reuse data (no skeleton flash), but a project switch
 * never does (real loading, no stale rows).
 */

const mocks = vi.hoisted(() => ({
  getWorkItems: vi.fn(),
  searchWorkItems: vi.fn(),
}));

vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: mocks.getWorkItems,
}));
vi.mock("@/fetchers/work-item/search-work-items", () => ({
  default: mocks.searchWorkItems,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

/** A promise this test resolves on its own schedule, so it can inspect the hook's
 * state WHILE a fetch is still in flight -- the exact window the bug lived in. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeResult(ids: string[]): WorkItemsResult {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture, full WorkItemRow shape not needed
    items: ids.map((id) => ({ id }) as any),
    hasPartialFailure: false,
    hasMore: false,
  };
}

describe("useGetWorkItems: placeholderData scoping (#310 delta review finding)", () => {
  beforeEach(() => {
    mocks.getWorkItems.mockReset();
  });

  it("keeps the previous data while a SORT change is loading, for the SAME project -- no skeleton flash", async () => {
    const first = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockReturnValueOnce(first.promise);

    const { result, rerender } = renderHook(
      ({ sort }: { sort: "key" | "title" }) =>
        useGetWorkItems({ projectId: "proj-a", sort, dir: "asc" }),
      {
        wrapper: createWrapper(),
        initialProps: { sort: "key" as "key" | "title" },
      },
    );

    first.resolve(makeResult(["a1"]));
    await waitFor(() =>
      expect(result.current.data).toEqual(makeResult(["a1"])),
    );
    expect(result.current.isLoading).toBe(false);

    const second = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockReturnValueOnce(second.promise);
    rerender({ sort: "title" });

    // Immediately after the sort change, before the new fetch resolves: no loading
    // state, and the PREVIOUS project's data is still visible (this is the desired
    // "no flash" behaviour -- `isPlaceholderData` proves it's the placeholder, not a
    // coincidentally-identical real result).
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual(makeResult(["a1"]));
    expect(result.current.isPlaceholderData).toBe(true);

    second.resolve(makeResult(["a1-resorted"]));
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data).toEqual(makeResult(["a1-resorted"]));
  });

  it("does NOT reuse data across a PROJECT switch -- real loading shows, and the other project's rows never appear", async () => {
    const first = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockReturnValueOnce(first.promise);

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useGetWorkItems({ projectId, sort: "key", dir: "asc" }),
      { wrapper: createWrapper(), initialProps: { projectId: "proj-a" } },
    );

    first.resolve(makeResult(["a1"]));
    await waitFor(() =>
      expect(result.current.data).toEqual(makeResult(["a1"])),
    );

    const second = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockReturnValueOnce(second.promise);
    rerender({ projectId: "proj-b" });

    // Immediately after the project switch, before B's fetch resolves: this is
    // exactly the bug's window -- must be a REAL loading state with NO stale data,
    // not project A's rows surviving into project B's page.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);

    second.resolve(makeResult(["b1"]));
    await waitFor(() =>
      expect(result.current.data).toEqual(makeResult(["b1"])),
    );
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useGetWorkItems: structured filter (SV-11)", () => {
  beforeEach(() => {
    mocks.getWorkItems.mockReset();
    mocks.searchWorkItems.mockReset();
  });

  it("reads the list route when no structured filter is set", async () => {
    mocks.getWorkItems.mockResolvedValue(makeResult(["a1"]));
    const { result } = renderHook(
      () =>
        useGetWorkItems({
          projectId: "proj-a",
          projectSlug: "OPS",
          workspaceId: "ws-1",
          filter: "  ",
          sort: "title",
          dir: "desc",
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.getWorkItems).toHaveBeenCalledWith("proj-a", "title", "desc");
    expect(mocks.searchWorkItems).not.toHaveBeenCalled();
  });

  it("reads through structured search, scoped to the workspace and project, for a filter", async () => {
    mocks.searchWorkItems.mockResolvedValue(makeResult(["s1"]));
    const { result } = renderHook(
      () =>
        useGetWorkItems({
          projectId: "proj-a",
          projectSlug: "OPS",
          workspaceId: "ws-1",
          filter: "assignee:@me",
          columns: ["key", "state"],
          sort: "priority",
          dir: "desc",
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.searchWorkItems).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      projectSlug: "OPS",
      filter: "assignee:@me",
      sort: "priority",
      dir: "desc",
      columns: ["key", "state"],
    });
    expect(mocks.getWorkItems).not.toHaveBeenCalled();
  });

  it("waits for the workspace instead of searching without a scope", () => {
    renderHook(
      () =>
        useGetWorkItems({
          projectId: "proj-a",
          projectSlug: "OPS",
          filter: "assignee:@me",
          sort: "key",
          dir: "asc",
        }),
      { wrapper: createWrapper() },
    );
    expect(mocks.searchWorkItems).not.toHaveBeenCalled();
    expect(mocks.getWorkItems).not.toHaveBeenCalled();
  });

  it("keeps every read under [work-items, projectId] so realtime and mutation invalidations reach it", async () => {
    mocks.searchWorkItems.mockResolvedValue(makeResult(["s1"]));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useGetWorkItems({
          projectId: "proj-a",
          projectSlug: "OPS",
          workspaceId: "ws-1",
          filter: "assignee:@me",
          sort: "key",
          dir: "asc",
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["work-items", "proj-a"] }),
    ).toHaveLength(1);
    mocks.searchWorkItems.mockClear();
    await queryClient.invalidateQueries({ queryKey: ["work-items", "proj-a"] });
    expect(mocks.searchWorkItems).toHaveBeenCalledTimes(1);
  });

  it("does not show another project's filtered rows while a project switch loads", async () => {
    mocks.searchWorkItems.mockResolvedValueOnce(makeResult(["a1"]));
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useGetWorkItems({
          projectId,
          projectSlug: "OPS",
          workspaceId: "ws-1",
          filter: "priority:high",
          sort: "key",
          dir: "asc",
        }),
      { wrapper: createWrapper(), initialProps: { projectId: "proj-a" } },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual(makeResult(["a1"])),
    );
    const second = deferred<WorkItemsResult>();
    mocks.searchWorkItems.mockReturnValueOnce(second.promise);
    rerender({ projectId: "proj-b" });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});
