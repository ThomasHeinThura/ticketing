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
}));

vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: mocks.getWorkItems,
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
