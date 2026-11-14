import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotionPreference } from "./use-reduced-motion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useReducedMotionPreference", () => {
  it("tracks preference changes and removes its listener on unmount", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const media = {
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media),
    );
    const { result, unmount } = renderHook(() => useReducedMotionPreference());
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      for (const listener of listeners) listener();
    });
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
