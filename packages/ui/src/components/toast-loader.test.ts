import { afterEach, describe, expect, it, vi } from "vitest";
import { createToastContentsLoader } from "./toast-loader";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("toast contents loading", () => {
  it("shares pending work, retries twice with backoff, and caches success", async () => {
    vi.useFakeTimers();
    const contents = {} as typeof import("./toast-viewport");
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(contents);
    const load = createToastContentsLoader(importer);
    const pending = load();
    expect(load()).toBe(pending);
    await vi.advanceTimersByTimeAsync(249);
    expect(importer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(importer).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(750);
    expect(await pending).toBe(contents);
    expect(load()).toBe(pending);
    expect(importer).toHaveBeenCalledTimes(3);
  });

  it("does not retain a rejected promise", async () => {
    vi.useFakeTimers();
    const importer = vi.fn().mockRejectedValue(new Error("offline"));
    const load = createToastContentsLoader(importer);
    const failure = expect(load()).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(1_000);
    await failure;
    importer.mockResolvedValue({});
    await expect(load()).resolves.toEqual({});
    expect(importer).toHaveBeenCalledTimes(4);
  });

  it("schedules one idle warm-up only after two paint frames", async () => {
    vi.resetModules();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback) => {
        frames.push(callback);
        return 1;
      }),
    );
    const idle = vi.fn();
    vi.stubGlobal("requestIdleCallback", idle);
    const { warmToastContents } = await import("./toast-loader");
    expect(frames).toHaveLength(0);
    warmToastContents();
    warmToastContents();
    expect(idle).not.toHaveBeenCalled();
    frames.shift()?.(0);
    expect(idle).not.toHaveBeenCalled();
    frames.shift()?.(16);
    expect(idle).toHaveBeenCalledOnce();
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 });
  });

  it("uses a bounded timeout when idle callbacks are unavailable", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback) => {
        frames.push(callback);
        return 1;
      }),
    );
    vi.stubGlobal("requestIdleCallback", undefined);
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const { warmToastContents } = await import("./toast-loader");
    warmToastContents();
    frames.shift()?.(0);
    frames.shift()?.(16);
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 1_000);
  });
});
