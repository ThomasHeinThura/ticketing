import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("whenPaletteWarm", () => {
  it("resolves as soon as the palette has warmed", async () => {
    const { markPaletteWarm, whenPaletteWarm } = await import("./palette-warm");
    vi.useFakeTimers();
    let resolved = false;
    void whenPaletteWarm(1_500).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);
    markPaletteWarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });

  it("stops waiting after its bound when the palette never warms", async () => {
    const { whenPaletteWarm } = await import("./palette-warm");
    vi.useFakeTimers();
    let resolved = false;
    void whenPaletteWarm(1_500).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});
