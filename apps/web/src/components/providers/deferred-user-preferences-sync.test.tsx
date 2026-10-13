import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/providers/auth-provider";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { DeferredUserPreferencesSync } from "./deferred-user-preferences-sync";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("@/fetchers/user-settings/user-settings", () => ({
  getUserSettings: mocks.get,
  patchUserSettings: mocks.put,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mocks.get.mockReset();
  useUserPreferencesStore.setState({ compactMode: false });
});

function renderDeferred() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider
        value={{
          user: { id: "user-1" } as never,
          isLoading: false,
          refetchUser: async () => {},
        }}
      >
        <DeferredUserPreferencesSync />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("DeferredUserPreferencesSync", () => {
  it("does not fetch settings on mount, only once the browser is idle", async () => {
    mocks.get.mockResolvedValue({ settings: { density: "compact" } });
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      idleCallbacks.push(cb);
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", () => {});

    renderDeferred();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(idleCallbacks).toHaveLength(1);

    await act(async () => {
      idleCallbacks[0]?.();
    });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    });
    // First paint came from the cache; the server value then replaces it.
    await waitFor(() =>
      expect(useUserPreferencesStore.getState().compactMode).toBe(true),
    );
  });

  it("never starts the sync if unmounted before the idle callback", async () => {
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
      idleCallbacks.push(cb);
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", () => {});

    const view = renderDeferred();
    view.unmount();
    await act(async () => {
      idleCallbacks[0]?.();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
