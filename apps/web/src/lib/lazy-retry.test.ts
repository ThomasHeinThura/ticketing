import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  importWithRetry,
  isChunkLoadError,
  reloadOnceForChunkError,
} from "./lazy-retry";

const chunkError = () =>
  new TypeError(
    "Failed to fetch dynamically imported module: https://ticketing.localhost/assets/x.js",
  );

describe("isChunkLoadError", () => {
  it.each([
    "Failed to fetch dynamically imported module: /assets/work-item-detail.js",
    "error loading dynamically imported module: /assets/app-sidebar.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/app-sidebar.css",
  ])("recognises %s", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("ignores other errors and non-errors", () => {
    expect(isChunkLoadError(new Error("Failed to fetch"))).toBe(false);
    expect(isChunkLoadError("Importing a module script failed")).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("importWithRetry", () => {
  it("imports again after a chunk load error and returns the module", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValueOnce({ default: "module" });
    await expect(importWithRetry(load, [0])).resolves.toEqual({
      default: "module",
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("passes the last chunk load error on once the retries are spent", async () => {
    const load = vi.fn().mockRejectedValue(chunkError());
    await expect(importWithRetry(load, [0, 0])).rejects.toThrow(
      "Failed to fetch dynamically imported module",
    );
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not retry a failed CSS preload in place, so it goes on to the reload", async () => {
    const cssError = new Error(
      "Unable to preload CSS for /assets/editor-styles.css",
    );
    const load = vi
      .fn()
      .mockRejectedValueOnce(cssError)
      .mockResolvedValueOnce({ default: "module" });
    await expect(importWithRetry(load, [0, 0])).rejects.toBe(cssError);
    expect(load).toHaveBeenCalledTimes(1);
    expect(isChunkLoadError(cssError)).toBe(true);
  });

  it("does not retry an error that is not a chunk load error", async () => {
    const load = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(importWithRetry(load, [0, 0])).rejects.toThrow("boom");
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("reloadOnceForChunkError", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("does not reload again for a chunk TanStack Router already reloaded for", () => {
    const error = chunkError();
    sessionStorage.setItem(`tanstack_router_reload:${error.message}`, "1");
    const reload = vi.fn();
    expect(reloadOnceForChunkError(error, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("scopes Safari's message, which names no chunk, by the page path", () => {
    const safari = () => new TypeError("Importing a module script failed.");
    // TanStack's record for this message is not chunk-specific, so it does not block.
    sessionStorage.setItem(`tanstack_router_reload:${safari().message}`, "1");
    const reload = vi.fn();
    window.history.replaceState(null, "", "/agent/work-items");
    expect(reloadOnceForChunkError(safari(), reload)).toBe(true);
    expect(reloadOnceForChunkError(safari(), reload)).toBe(false);
    window.history.replaceState(null, "", "/agent/kb");
    expect(reloadOnceForChunkError(safari(), reload)).toBe(true);
    expect(reloadOnceForChunkError(safari(), reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("reloads once for a failing chunk, then refuses that chunk again", () => {
    const reload = vi.fn();
    expect(reloadOnceForChunkError(chunkError(), reload)).toBe(true);
    expect(reloadOnceForChunkError(chunkError(), reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still reloads once for a different chunk", () => {
    const reload = vi.fn();
    reloadOnceForChunkError(chunkError(), reload);
    const other = new TypeError(
      "Failed to fetch dynamically imported module: https://ticketing.localhost/assets/y.js",
    );
    expect(reloadOnceForChunkError(other, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when session storage cannot record the attempt", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked });
    const reload = vi.fn();
    expect(reloadOnceForChunkError(chunkError(), reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
