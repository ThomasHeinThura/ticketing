import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSettingsFrame } from "./workspace-settings-frame";

const permissions = vi.hoisted(() => ({
  settings: false,
  calendars: false,
  roles: false,
  webhooks: false,
  fields: false,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/dashboard/settings/workspace/general" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/components/SettingsSidebar", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    workspace: { id: "w1", name: "Acme" },
    role: "member",
    canManageWorkspaceSettings: () => permissions.settings,
    canManageServiceCalendars: () => permissions.calendars,
    canManageRoles: () => permissions.roles,
    canManageWebhooks: () => permissions.webhooks,
    canManageCustomFields: () => permissions.fields,
  }),
}));

afterEach(() => {
  cleanup();
  Object.assign(permissions, {
    settings: false,
    calendars: false,
    roles: false,
    webhooks: false,
    fields: false,
  });
});

describe("WorkspaceSettingsFrame", () => {
  it("shows a plain member only the entries they can open (C6)", () => {
    permissions.settings = false;
    permissions.calendars = false;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/dashboard/settings/workspace/general",
      "/dashboard/settings/workspace/labels",
    ]);
  });

  it("shows every configuration entry to someone who can manage settings", () => {
    permissions.settings = true;
    permissions.calendars = true;
    permissions.roles = true;
    permissions.webhooks = true;
    permissions.fields = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/agent/settings/automations");
    expect(hrefs).toContain("/agent/settings/webhooks");
    expect(hrefs).toContain("/agent/settings/roles");
    expect(hrefs).toContain("/agent/settings/sla-policies");
    expect(hrefs).toHaveLength(13);
  });

  it("gates Roles, Webhooks and Custom fields on the capability their API enforces (M9)", () => {
    // Settings rights alone do not open them.
    permissions.settings = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    let hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/agent/settings/roles");
    expect(hrefs).not.toContain("/agent/settings/webhooks");
    expect(hrefs).not.toContain("/agent/settings/custom-fields");
    cleanup();

    // A webhook:manage holder without workspace settings still gets the entry.
    permissions.settings = false;
    permissions.webhooks = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/agent/settings/webhooks");
    expect(hrefs).not.toContain("/agent/settings/custom-fields");
  });
});
