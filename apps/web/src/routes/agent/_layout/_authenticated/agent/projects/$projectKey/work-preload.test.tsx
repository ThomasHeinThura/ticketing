import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workItemsPanelLoaded: vi.fn(),
  reads: Promise.resolve(),
  prefetchWorkListData: vi.fn(),
  waitForWorkListFirstPaint: vi.fn(),
}));

vi.mock("@/lib/work-list-prefetch", () => ({
  prefetchWorkListData: (...args: unknown[]) =>
    mocks.prefetchWorkListData(...args),
}));
vi.mock("@/lib/work-list-first-paint", () => ({
  waitForWorkListFirstPaint: (...args: unknown[]) =>
    mocks.waitForWorkListFirstPaint(...args),
}));

vi.mock("@/components/work-item/work-items-panel", () => {
  mocks.workItemsPanelLoaded();
  return { default: () => null };
});

import { Route } from "./work";

describe("work list route preload", () => {
  it("starts loading the list panel during route beforeLoad", async () => {
    mocks.workItemsPanelLoaded.mockClear();

    await Route.options.beforeLoad?.({
      context: { queryClient: new QueryClient(), session: null },
      params: { projectKey: "WLP" },
      search: { layout: "list", sort: "key", dir: "asc" },
      cause: "preload",
    } as never);
    await vi.waitFor(() =>
      expect(mocks.workItemsPanelLoaded).toHaveBeenCalledOnce(),
    );
  });

  it("hands the list's reads to the loader, which holds the first paint for them", async () => {
    mocks.prefetchWorkListData.mockReturnValue(mocks.reads);
    const wait = Promise.resolve();
    mocks.waitForWorkListFirstPaint.mockReturnValue(wait);

    const context = await Route.options.beforeLoad?.({
      context: { queryClient: new QueryClient(), session: null },
      params: { projectKey: "WLP" },
      search: { layout: "list", sort: "key", dir: "asc" },
      cause: "enter",
    } as never);
    expect(context).toEqual({ workListFirstPaint: mocks.reads });

    const loader = Route.options.loader as (context: never) => unknown;
    const loaded = loader({
      context: { workListFirstPaint: mocks.reads },
      cause: "enter",
    } as never);
    expect(mocks.waitForWorkListFirstPaint).toHaveBeenCalledWith({
      cause: "enter",
      reads: mocks.reads,
    });
    expect(loaded).toBe(wait);
  });

  it("does not hold other layouts or a search change for the reads", async () => {
    mocks.prefetchWorkListData.mockReturnValue(mocks.reads);
    for (const [layout, cause] of [
      ["table", "enter"],
      ["board", "enter"],
      ["list", "stay"],
    ] as const) {
      const context = await Route.options.beforeLoad?.({
        context: { queryClient: new QueryClient(), session: null },
        params: { projectKey: "WLP" },
        search: { layout, sort: "key", dir: "asc" },
        cause,
      } as never);
      expect(context).toEqual({ workListFirstPaint: undefined });
    }
  });
});
