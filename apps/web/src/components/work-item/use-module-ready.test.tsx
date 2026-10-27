import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useModuleReady } from "./use-module-ready";

describe("useModuleReady", () => {
  it("is ready at once for a loaded module, without loading it again", () => {
    const load = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useModuleReady(load, () => true));
    expect(result.current).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it("becomes ready once the module has loaded", async () => {
    let loaded = false;
    let finish: () => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            loaded = true;
            resolve();
          };
        }),
    );
    const { result } = renderHook(() => useModuleReady(load, () => loaded));
    expect(result.current).toBe(false);
    expect(load).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(result.current).toBe(true);
  });

  it("reports ready after a failed download, so the lazy boundary surfaces it", async () => {
    const load = vi.fn(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useModuleReady(load, () => false));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("loads nothing while disabled", () => {
    const load = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useModuleReady(load, () => false, false),
    );
    expect(result.current).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });
});
