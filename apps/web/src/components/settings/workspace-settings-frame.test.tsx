import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSettingsFrame } from "./workspace-settings-frame";

const permissions = vi.hoisted(() => ({
  settings: false,
  calendars: false,
  roles: false,
  webhooks: false,
  fields: false,
  invite: false,
  rates: false,
  workflows: false,
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
    canInviteUsers: () => permissions.invite,
    canManageRates: () => permissions.rates,
    canManageWorkflows: () => permissions.workflows,
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
    invite: false,
    rates: false,
    workflows: false,
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
    permissions.invite = true;
    permissions.rates = true;
    permissions.workflows = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/agent/settings/automations");
    expect(hrefs).toContain("/agent/settings/customer-invitations");
    expect(hrefs).toContain("/agent/settings/webhooks");
    expect(hrefs).toContain("/agent/settings/roles");
    expect(hrefs).toContain("/agent/settings/sla-policies");
    expect(hrefs).toContain("/agent/settings/time-activities");
    expect(hrefs).toContain("/agent/settings/rates");
    // General, labels and the 14 gated entries: roles, canned responses, templates, calendars,
    // SLA policies, request types, workflows, teams, time activities, rates, custom fields,
    // customer invitations, automations and webhooks.
    expect(hrefs).toContain("/dashboard/settings/workspace/features");
    expect(hrefs).toContain("/dashboard/settings/workspace/terminology");
    expect(hrefs).toHaveLength(18);
  });

  it("gates Roles, Webhooks and Custom fields on the capability their API enforces (M9)", () => {
    // Settings rights alone do not open them.
    permissions.settings = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    let hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/agent/settings/roles");
    expect(hrefs).not.toContain("/agent/settings/webhooks");
    expect(hrefs).not.toContain("/agent/settings/custom-fields");
    // Customer invitations follow member:invite, not workspace settings.
    expect(hrefs).not.toContain("/agent/settings/customer-invitations");
    cleanup();

    // A webhook:manage holder without workspace settings still gets the entry.
    permissions.settings = false;
    permissions.webhooks = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/agent/settings/webhooks");
    expect(hrefs).not.toContain("/agent/settings/custom-fields");
    cleanup();

    // A member:invite holder without workspace settings gets only the invitations entry.
    permissions.webhooks = false;
    permissions.invite = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/agent/settings/customer-invitations");
    expect(hrefs).not.toContain("/agent/settings/webhooks");
  });

  it("shows each P5 entry exactly to the holder of the capability its API enforces (R5-03)", () => {
    const hrefsFor = () =>
      screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    // Settings rights alone open neither Rates nor Workflows.
    permissions.settings = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    expect(hrefsFor()).toContain("/agent/settings/time-activities");
    expect(hrefsFor()).not.toContain("/agent/settings/rates");
    expect(hrefsFor()).not.toContain("/agent/settings/workflows");
    cleanup();

    // A finance role with manage_rates but no settings rights reaches Rates only.
    permissions.settings = false;
    permissions.rates = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    expect(hrefsFor()).toContain("/agent/settings/rates");
    expect(hrefsFor()).not.toContain("/agent/settings/time-activities");
    expect(hrefsFor()).not.toContain("/agent/settings/workflows");
    cleanup();

    // workflow:manage alone opens Workflows (and the CAB template on it) only.
    permissions.rates = false;
    permissions.workflows = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    expect(hrefsFor()).toContain("/agent/settings/workflows");
    expect(hrefsFor()).not.toContain("/agent/settings/rates");
    expect(hrefsFor()).not.toContain("/agent/settings/time-activities");
  });
});
