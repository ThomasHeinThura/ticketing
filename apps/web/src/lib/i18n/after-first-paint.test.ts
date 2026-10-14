import { afterEach, describe, expect, it, vi } from "vitest";
import { afterFirstPaint } from "./after-first-paint";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("afterFirstPaint", () => {
  it("waits for first-contentful-paint, then for idle time", async () => {
    let notify: (list: { getEntriesByName: (n: string) => unknown[] }) => void =
      () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const idle = vi.fn((callback: () => void) => callback());
    vi.stubGlobal("requestIdleCallback", idle);

    let resolved = false;
    const promise = afterFirstPaint().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(idle).not.toHaveBeenCalled();

    notify({ getEntriesByName: () => [{}] });
    await promise;
    expect(idle).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it("falls back to a timer when the page never paints", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => callback());
    const promise = afterFirstPaint({ paintTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBeUndefined();
  });
});
