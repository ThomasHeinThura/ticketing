import { SidebarProvider } from "@taskdesk/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SidebarToggle from "./sidebar-toggle";

let release: () => void = () => {};
vi.mock("@/lib/after-primary-content", () => ({
  afterPrimaryContent: () =>
    new Promise<void>((resolve) => {
      release = resolve;
    }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

describe("SidebarToggle", () => {
  it("keeps its name and keyboard focus when its tooltip arrives", async () => {
    render(
      <SidebarProvider>
        <SidebarToggle />
      </SidebarProvider>,
    );
    const before = screen.getByRole("button", {
      name: "common:a11y.toggleSidebar",
    });
    before.focus();
    expect(before).toHaveFocus();

    await act(async () => release());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "common:a11y.toggleSidebar" }),
      ).toHaveFocus(),
    );
  });
});
