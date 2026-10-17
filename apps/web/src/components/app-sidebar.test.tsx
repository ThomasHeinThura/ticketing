import { SidebarProvider } from "@taskdesk/ui";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./app-sidebar";

const navProjects = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
});

vi.mock("@/components/nav-projects", async () => {
  await navProjects.pending;
  return { NavProjects: () => null };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/nav-main", () => ({ NavMain: () => null }));
vi.mock("@/components/theme-toggle-dropdown", () => ({
  ThemeToggleDropdown: () => null,
}));
vi.mock("@/components/version-display", () => ({
  VersionDisplay: () => null,
}));
vi.mock("@/components/workspace-switcher", () => ({
  WorkspaceSwitcher: () => null,
}));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Meta",
  useRegisterShortcuts: () => {},
}));
vi.mock("./search", () => ({ default: () => null }));

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppSidebar loading navigation", () => {
  it("keeps lazy project navigation skeletons inside list items", async () => {
    render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    const menu = document.querySelector('[data-sidebar="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.children).toHaveLength(2);
    for (const item of Array.from(menu?.children ?? [])) {
      expect(item.tagName).toBe("LI");
      expect(item.querySelector('[data-sidebar="menu-skeleton"]')).not.toBe(
        null,
      );
    }

    navProjects.release();
  });
});
