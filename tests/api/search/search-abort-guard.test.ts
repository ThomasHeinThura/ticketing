import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { stopAbortedSearch } from "../../../apps/api/src/search";

describe("search abort guard", () => {
  it("skips downstream work when the request is already aborted", async () => {
    const app = new Hono();
    const heavyStage = vi.fn(
      async (c: Parameters<typeof stopAbortedSearch>[0]) => c.text("ran"),
    );
    app.get("/search", stopAbortedSearch, heavyStage);

    const controller = new AbortController();
    controller.abort();
    const response = await app.request("/search", {
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [],
      totalCount: 0,
      searchQuery: "",
    });
    expect(heavyStage).not.toHaveBeenCalled();
  });

  it("checks again after an async stage and skips the stages after it", async () => {
    const app = new Hono();
    let markStageStarted!: () => void;
    let releaseStage!: () => void;
    const stageStarted = new Promise<void>((resolve) => {
      markStageStarted = resolve;
    });
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve;
    });
    const secondHeavyStage = vi.fn(
      async (c: Parameters<typeof stopAbortedSearch>[0]) => c.text("ran"),
    );
    app.get(
      "/search",
      stopAbortedSearch,
      async (_c, next) => {
        markStageStarted();
        await stageGate;
        return next();
      },
      stopAbortedSearch,
      secondHeavyStage,
    );

    const controller = new AbortController();
    const responsePromise = app.request("/search", {
      signal: controller.signal,
    });
    await stageStarted;
    controller.abort();
    releaseStage();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [],
      totalCount: 0,
      searchQuery: "",
    });
    expect(secondHeavyStage).not.toHaveBeenCalled();
  });

  it("continues the normal route when the request remains live", async () => {
    const app = new Hono();
    const normalStage = vi.fn(
      async (c: Parameters<typeof stopAbortedSearch>[0]) => c.text("ran"),
    );
    app.get("/search", stopAbortedSearch, normalStage);

    const response = await app.request("/search");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ran");
    expect(normalStage).toHaveBeenCalledOnce();
  });
});
