import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterPrimaryContent } from "./after-primary-content";

// Exercise the real paint/idle helper: the old primary-content tests mock it away and
// cannot catch downloading secondary code only after the complete idle wait.
let idle: (() => void) | undefined;
beforeEach(() => {
  window.history.replaceState(null, "", "/agent/projects/HELP/work");
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([
    { name: "first-contentful-paint" } as PerformanceEntry,
  ]);
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idle = callback;
    return 1;
  });
});
afterEach(() => {
  idle = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("primary content downloads and deferred rendering", () => {
  it("starts downloads at the real marker before idle, but defers rendering until idle", async () => {
    const download = vi.fn();
    const render = vi.fn();
    const ready = afterPrimaryContent({ onPrimaryContentReady: download }).then(
      render,
    );
    await flush();
    expect(download).not.toHaveBeenCalled();
    expect(idle).toBeUndefined();

    const primary = document.createElement("div");
    document.body.append(primary);
    primary.setAttribute("data-primary-content-ready", "true");
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
    expect(idle).toBeTypeOf("function");
    expect(render).not.toHaveBeenCalled();
    idle?.();
    await ready;
    expect(render).toHaveBeenCalledTimes(1);
    primary.append(document.createElement("div"));
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("prefetches an already-ready heavy screen without waiting for idle", async () => {
    document.body.innerHTML = '<div data-primary-content-ready="true"></div>';
    const download = vi.fn();
    const ready = afterPrimaryContent({ onPrimaryContentReady: download });
    expect(download).toHaveBeenCalledTimes(1);
    idle?.();
    await ready;
  });

  it("does not prefetch on timeout without primary content", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const download = vi.fn();
    const ready = afterPrimaryContent({
      timeoutMs: 100,
      onPrimaryContentReady: download,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(download).not.toHaveBeenCalled();
    idle?.();
    await ready;
  });

  it("does not prefetch on a light screen before first paint/idle", async () => {
    window.history.replaceState(null, "", "/agent/inbox");
    const download = vi.fn();
    const ready = afterPrimaryContent({ onPrimaryContentReady: download });
    expect(download).not.toHaveBeenCalled();
    idle?.();
    await ready;
  });

  it("does not download for an aborted screen, even if its marker is present", async () => {
    document.body.innerHTML = '<div data-primary-content-ready="true"></div>';
    const abort = new AbortController();
    abort.abort(new Error("left screen"));
    const download = vi.fn();
    await expect(
      afterPrimaryContent({
        signal: abort.signal,
        onPrimaryContentReady: download,
      }),
    ).rejects.toThrow("left screen");
    expect(download).not.toHaveBeenCalled();
  });
});
