import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSettingsFrame } from "./account-settings-frame";

const location = vi.hoisted(() => ({
  pathname: "/dashboard/settings/account/information",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => location,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/components/SettingsSidebar", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({
    user: { name: "Ada Lovelace", email: "ada@example.test" },
  }),
}));

afterEach(() => {
  cleanup();
  location.pathname = "/dashboard/settings/account/information";
});

describe("AccountSettingsFrame (L-03)", () => {
  it("lists every account page, including Security and Pending actions", () => {
    render(<AccountSettingsFrame>content</AccountSettingsFrame>);

    const links = screen
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["settings:information", "/dashboard/settings/account/information"],
      ["settings:notifications", "/dashboard/settings/account/notifications"],
      ["settings:preferences", "/dashboard/settings/account/preferences"],
      ["settings:security", "/dashboard/settings/account/security"],
      [
        "navigation:sidebar.pendingActions",
        "/agent/settings/profile/pending-actions",
      ],
      ["settings:apiKeys", "/dashboard/settings/account/developer"],
    ]);
  });

  it("marks Security as the current page on the security URL", () => {
    location.pathname = "/dashboard/settings/account/security";
    render(<AccountSettingsFrame>content</AccountSettingsFrame>);

    expect(
      screen.getByRole("link", { name: "settings:security" }).className,
    ).toContain("bg-sidebar-accent");
    expect(
      screen.getByRole("link", { name: "settings:information" }).className,
    ).not.toContain("bg-sidebar-accent");
  });
});
