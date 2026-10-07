import { describe, expect, it, vi } from "vitest";
import { parseWorkItemListSearch, routes } from "@/lib/routes";
import { Route as AuthenticatedRoute } from "@/routes/agent/_layout/_authenticated";

const mocks = vi.hoisted(() => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  return {
    started: {
      panel: vi.fn(),
      list: vi.fn(),
      trigger: vi.fn(),
    },
    gates: {
      panel: deferred(),
      list: deferred(),
      trigger: deferred(),
    },
  };
});

vi.mock("@/components/work-item/work-items-panel", async () => {
  mocks.started.panel();
  await mocks.gates.panel.promise;
  return { default: () => null };
});

vi.mock("@/components/work-item/work-item-list", async () => {
  mocks.started.list();
  await mocks.gates.list.promise;
  return { default: () => null };
});

vi.mock("@/components/work-item/work-item-create-trigger", async () => {
  mocks.started.trigger();
  await mocks.gates.trigger.promise;
  return { default: () => null };
});

import { Route } from "./work";

describe("work list route preload", () => {
  it("starts the panel and visible child chunks together without changing route guards", async () => {
    expect(routes.workItemList.path).toBe("/agent/projects/$projectKey/work");
    expect(AuthenticatedRoute.options.beforeLoad).toBeTypeOf("function");
    expect(Route.options.beforeLoad).toBeTypeOf("function");
    expect(Route.options.validateSearch).toBe(parseWorkItemListSearch);
    expect(
      parseWorkItemListSearch({
        layout: "list",
        sort: "title",
        dir: "asc",
      }),
    ).toEqual({ layout: "list", sort: "title", dir: "asc" });

    const result = Route.options.beforeLoad?.({} as never);
    expect(result).toBeUndefined();
    await vi.waitFor(() => {
      expect(mocks.started.panel).toHaveBeenCalledOnce();
      expect(mocks.started.list).toHaveBeenCalledOnce();
      expect(mocks.started.trigger).toHaveBeenCalledOnce();
    });

    mocks.gates.list.resolve();
    mocks.gates.trigger.resolve();
    mocks.gates.panel.reject(new Error("panel preload failure"));
    await vi.waitFor(() => {
      expect(mocks.started.list).toHaveBeenCalledOnce();
      expect(mocks.started.trigger).toHaveBeenCalledOnce();
    });
    await expect(Promise.resolve(result)).resolves.toBeUndefined();
  });
});
