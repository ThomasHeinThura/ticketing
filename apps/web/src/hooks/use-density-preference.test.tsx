import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/providers/auth-provider";
import { useUserPreferencesStore } from "@/store/user-preferences";
import {
  useDensityPreference,
  useDensityPreferenceSync,
} from "./use-density-preference";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@/fetchers/user-settings/user-settings", () => ({
  getUserSettings: mocks.get,
  patchUserSettings: mocks.put,
}));

const user = { id: "user-1" } as never;
const migratedKey = "taskdesk:preference-migrated:user-1:density";
const dirtyKey = "taskdesk:preference-dirty:user-1:density";

function serverHas(density?: "comfortable" | "compact") {
  mocks.get.mockResolvedValue({ settings: density ? { density } : {} });
}

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{ user, isLoading: false, refetchUser: async () => {} }}
        >
          {children}
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  };
}

describe("density preference sync (VW-6, views.md PREF-8)", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.put.mockResolvedValue({});
    useUserPreferencesStore.setState({ compactMode: false });
  });
  afterEach(cleanup);

  it("migrates an existing local compact value to the server exactly once", async () => {
    useUserPreferencesStore.setState({ compactMode: true });
    serverHas(undefined);

    const first = renderHook(() => useDensityPreferenceSync(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(mocks.put).toHaveBeenCalledWith({ density: "compact" });
    await waitFor(() => expect(localStorage.getItem(migratedKey)).toBe("1"));
    first.unmount();

    // A second load (new query client, server still empty) does not upload again.
    renderHook(() => useDensityPreferenceSync(), { wrapper: wrapper() });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    // Let the second load's query resolve and its reconcile effect run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });

  it("adopts the server value over the local cache", async () => {
    useUserPreferencesStore.setState({ compactMode: true });
    serverHas("comfortable");
    renderHook(() => useDensityPreferenceSync(), { wrapper: wrapper() });
    await waitFor(() =>
      expect(useUserPreferencesStore.getState().compactMode).toBe(false),
    );
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("keeps the local cache and writes nothing when the server read fails", async () => {
    useUserPreferencesStore.setState({ compactMode: true });
    mocks.get.mockRejectedValue(new Error("offline"));
    renderHook(() => useDensityPreferenceSync(), { wrapper: wrapper() });
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    await act(async () => {});
    expect(useUserPreferencesStore.getState().compactMode).toBe(true);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("keeps a failed local change dirty and pushes it instead of the stale server value", async () => {
    mocks.put.mockRejectedValueOnce(new Error("offline"));
    serverHas("comfortable");
    const { result } = renderHook(() => useDensityPreference(), {
      wrapper: wrapper(),
    });
    act(() => result.current.setDensity("compact"));
    // Local cache updates at once, even though the write fails.
    expect(useUserPreferencesStore.getState().compactMode).toBe(true);
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(dirtyKey)).toBe("1");

    renderHook(() => useDensityPreferenceSync(), { wrapper: wrapper() });
    await waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(2));
    expect(mocks.put).toHaveBeenLastCalledWith({ density: "compact" });
    expect(useUserPreferencesStore.getState().compactMode).toBe(true);
    await waitFor(() => expect(localStorage.getItem(dirtyKey)).toBeNull());
  });

  it("writes through to the server on a successful change and clears the dirty marker", async () => {
    serverHas(undefined);
    const { result } = renderHook(() => useDensityPreference(), {
      wrapper: wrapper(),
    });
    act(() => result.current.setDensity("compact"));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith({ density: "compact" }),
    );
    await waitFor(() => expect(localStorage.getItem(dirtyKey)).toBeNull());
    expect(localStorage.getItem(migratedKey)).toBe("1");
  });

  it("never uploads another user's local density for a different user on a shared browser", async () => {
    // user-0 chose compact in this browser and the copy is attributed to them.
    useUserPreferencesStore.setState({ compactMode: true });
    localStorage.setItem("taskdesk:preference-cache-owner:density", "user-0");
    serverHas(undefined);

    renderHook(() => useDensityPreferenceSync(), { wrapper: wrapper() });
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.put).not.toHaveBeenCalled();
    // The foreign value is not shown to the new user either.
    expect(useUserPreferencesStore.getState().compactMode).toBe(false);
    expect(
      localStorage.getItem("taskdesk:preference-cache-owner:density"),
    ).toBe("user-1");
  });
});
