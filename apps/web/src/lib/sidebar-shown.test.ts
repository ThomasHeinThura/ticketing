import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("whenSidebarShown", () => {
  it("resolves as soon as the sidebar has rendered", async () => {
    const { markSidebarShown, whenSidebarShown } = await import(
      "./sidebar-shown"
    );
    vi.useFakeTimers();
    let resolved = false;
    void whenSidebarShown(2_000).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);
    markSidebarShown();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("stops waiting after its bound when the sidebar never renders", async () => {
    const { whenSidebarShown } = await import("./sidebar-shown");
    vi.useFakeTimers();
    let resolved = false;
    void whenSidebarShown(2_000).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});
