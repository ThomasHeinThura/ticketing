import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/providers/auth-provider";
import { HttpError } from "@/lib/http-error";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { UserPreferencesSync } from "./user-preferences-sync";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("@/fetchers/user-settings/user-settings", () => ({
  getUserSettings: mocks.get,
  patchUserSettings: mocks.put,
}));

function renderApp() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AuthContext.Provider
        value={{
          user: { id: "user-1" } as never,
          isLoading: false,
          refetchUser: async () => {},
        }}
      >
        <UserPreferencesSync />
        <main>app content</main>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("UserPreferencesSync never blocks or replaces app rendering", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.put.mockResolvedValue({});
    useUserPreferencesStore.setState({ compactMode: true });
  });
  afterEach(cleanup);

  it.each([
    ["404", () => Promise.reject(new HttpError(404, "Not found"))],
    ["401", () => Promise.reject(new HttpError(401, "Unauthorized"))],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    // What a catch-all stub returns when the route is not mocked (the real fetcher rejects
    // this; the mock bypasses it, so this proves the hook itself is also defensive).
    ["an empty array body", () => Promise.resolve([])],
    ["an empty object body", () => Promise.resolve({})],
    ["null", () => Promise.resolve(null)],
    ["a hanging request", () => new Promise(() => {})],
  ])(
    "keeps rendering and keeps the cached density when GET /api/me/settings is %s",
    async (_name, respond) => {
      mocks.get.mockImplementation(respond);
      renderApp();
      await settle();
      expect(screen.getByText("app content")).toBeInTheDocument();
      expect(useUserPreferencesStore.getState().compactMode).toBe(true);
      expect(mocks.put).not.toHaveBeenCalled();
    },
  );
});
