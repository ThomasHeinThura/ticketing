import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/providers/auth-provider";
import { UserPreferencesEffects } from "@/components/providers/user-preferences-effects";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { Route } from "./preferences";

const patchUserSettings = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/user-settings/user-settings", () => ({
  getUserSettings: vi.fn(),
  patchUserSettings,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
}));
vi.mock("@/hooks/use-locale", () => ({
  useLocale: () => ({ locale: "en-US", setLocale: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const PreferencesPage = (Route as unknown as { component: ComponentType })
  .component;

function pick(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

describe("preferences page density setter (#673)", () => {
  beforeEach(() => {
    localStorage.clear();
    patchUserSettings.mockReset();
    patchUserSettings.mockResolvedValue({});
    useUserPreferencesStore.setState({ compactMode: false });
    document.documentElement.classList.remove("compact-mode");
  });
  afterEach(() => {
    cleanup();
    useUserPreferencesStore.setState({ compactMode: false });
  });

  it("switches density to compact and back, toggling html.compact-mode", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider
          value={{
            user: { id: "user-1" } as never,
            isLoading: false,
            refetchUser: async () => {},
          }}
        >
          <UserPreferencesEffects />
          <PreferencesPage />
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(document.documentElement).not.toHaveClass("compact-mode");

    fireEvent.click(screen.getByTestId("density-select"));
    pick(
      await screen.findByRole("option", {
        name: "settings:preferencesPage.densityCompact",
      }),
    );
    await waitFor(() =>
      expect(useUserPreferencesStore.getState().compactMode).toBe(true),
    );
    expect(document.documentElement).toHaveClass("compact-mode");
    // VW-6: the change is also persisted server-side.
    await waitFor(() =>
      expect(patchUserSettings).toHaveBeenCalledWith({ density: "compact" }),
    );

    fireEvent.click(screen.getByTestId("density-select"));
    pick(
      await screen.findByRole("option", {
        name: "settings:preferencesPage.densityComfortable",
      }),
    );
    await waitFor(() =>
      expect(useUserPreferencesStore.getState().compactMode).toBe(false),
    );
    expect(document.documentElement).not.toHaveClass("compact-mode");
  });
});
