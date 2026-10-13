import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesEffects } from "@/components/providers/user-preferences-effects";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { Route } from "./preferences";

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
    useUserPreferencesStore.setState({ compactMode: false });
    document.documentElement.classList.remove("compact-mode");
  });
  afterEach(() => {
    cleanup();
    useUserPreferencesStore.setState({ compactMode: false });
  });

  it("switches density to compact and back, toggling html.compact-mode", async () => {
    render(
      <>
        <UserPreferencesEffects />
        <PreferencesPage />
      </>,
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
