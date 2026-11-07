import { describe, expect, it, vi } from "vitest";
import {
  importWithRetry,
  isChunkLoadError,
  rememberCssPreloadFailure,
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

describe("rememberCssPreloadFailure", () => {
  const cssError = () =>
    new Error("Unable to preload CSS for /assets/editor-styles.css");

  it("keeps rejecting with a failed CSS preload after a later import would resolve", async () => {
    const error = cssError();
    const load = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ default: "module" });
    const remembered = rememberCssPreloadFailure(load);
    await expect(remembered()).rejects.toBe(error);
    await expect(remembered()).rejects.toBe(error);
    await expect(remembered()).rejects.toBe(error);
    expect(load).toHaveBeenCalledTimes(1);
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("imports again after any other failure", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ default: "module" });
    const remembered = rememberCssPreloadFailure(load);
    await expect(remembered()).rejects.toThrow(
      "Failed to fetch dynamically imported module",
    );
    await expect(remembered()).rejects.toThrow("boom");
    await expect(remembered()).resolves.toEqual({ default: "module" });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("passes a successful import through on every call", async () => {
    const load = vi.fn().mockResolvedValue({ default: "module" });
    const remembered = rememberCssPreloadFailure(load);
    await expect(remembered()).resolves.toEqual({ default: "module" });
    await expect(remembered()).resolves.toEqual({ default: "module" });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
