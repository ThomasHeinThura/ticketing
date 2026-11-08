import { cleanup, render, screen, within } from "@testing-library/react";
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
// P4R2-M1: the SLA areas follow the workspace's resolved `feature.sla`.
const workspaceFeatureState = vi.hoisted(() => ({ sla: true, loading: false }));
vi.mock("@/hooks/queries/feature-flag/use-workspace-features", () => ({
  default: () => ({
    isOn: (key: string) => key === "feature.sla" && workspaceFeatureState.sla,
    isLoading: workspaceFeatureState.loading,
  }),
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
  workspaceFeatureState.sla = true;
  workspaceFeatureState.loading = false;
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
    // Every member can open the members list; role changes and removal are gated inside it.
    expect(hrefs).toEqual([
      "/dashboard/settings/workspace/general",
      "/dashboard/settings/workspace/labels",
      "/dashboard/settings/workspace/members",
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
    expect(hrefs).toContain("/dashboard/settings/workspace/automations");
    expect(hrefs).toContain(
      "/dashboard/settings/workspace/customer-invitations",
    );
    expect(hrefs).toContain("/dashboard/settings/workspace/webhooks");
    expect(hrefs).toContain("/dashboard/settings/workspace/roles");
    expect(hrefs).toContain("/dashboard/settings/workspace/sla-policies");
    expect(hrefs).toContain("/dashboard/settings/workspace/time-activities");
    expect(hrefs).toContain("/dashboard/settings/workspace/rates");
    // General, labels, members and the 14 gated entries: roles, canned responses, templates, calendars,
    // SLA policies, request types, workflows, teams, time activities, rates, custom fields,
    // customer invitations, automations and webhooks.
    expect(hrefs).toContain("/dashboard/settings/workspace/features");
    expect(hrefs).toContain("/dashboard/settings/workspace/terminology");
    expect(hrefs).toContain("/dashboard/settings/workspace/members");
    expect(hrefs).toHaveLength(19);
  });

  it("gates Roles, Webhooks and Custom fields on the capability their API enforces (M9)", () => {
    // Settings rights alone do not open them.
    permissions.settings = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    let hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/dashboard/settings/workspace/roles");
    expect(hrefs).not.toContain("/dashboard/settings/workspace/webhooks");
    expect(hrefs).not.toContain("/dashboard/settings/workspace/custom-fields");
    // Customer invitations follow member:invite, not workspace settings.
    expect(hrefs).not.toContain(
      "/dashboard/settings/workspace/customer-invitations",
    );
    cleanup();

    // A webhook:manage holder without workspace settings still gets the entry.
    permissions.settings = false;
    permissions.webhooks = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/dashboard/settings/workspace/webhooks");
    expect(hrefs).not.toContain("/dashboard/settings/workspace/custom-fields");
    cleanup();

    // A member:invite holder without workspace settings gets only the invitations entry.
    permissions.webhooks = false;
    permissions.invite = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(
      "/dashboard/settings/workspace/customer-invitations",
    );
    expect(hrefs).not.toContain("/dashboard/settings/workspace/webhooks");
  });

  it("shows each P5 entry exactly to the holder of the capability its API enforces (R5-03)", () => {
    const hrefsFor = () =>
      screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    // Settings rights alone open neither Rates nor Workflows.
    permissions.settings = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    expect(hrefsFor()).toContain(
      "/dashboard/settings/workspace/time-activities",
    );
    expect(hrefsFor()).not.toContain("/dashboard/settings/workspace/rates");
    expect(hrefsFor()).not.toContain("/dashboard/settings/workspace/workflows");
    cleanup();

    // A finance role with manage_rates but no settings rights reaches Rates only.
    permissions.settings = false;
    permissions.rates = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    expect(hrefsFor()).toContain("/dashboard/settings/workspace/rates");
    expect(hrefsFor()).not.toContain(
      "/dashboard/settings/workspace/time-activities",
    );
    expect(hrefsFor()).not.toContain("/dashboard/settings/workspace/workflows");
    cleanup();

    // workflow:manage alone opens Workflows (and the CAB template on it) only.
    permissions.rates = false;
    permissions.workflows = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    expect(hrefsFor()).toContain("/dashboard/settings/workspace/workflows");
    expect(hrefsFor()).not.toContain("/dashboard/settings/workspace/rates");
    expect(hrefsFor()).not.toContain(
      "/dashboard/settings/workspace/time-activities",
    );
  });

  // UX-1a (SR-05, S2) replaces P4R2-M1's hiding: with feature.sla off the two entries stay
  // visible to holders of sla_policy:manage, marked Off, so an admin can find and switch them on.
  it("keeps Service calendars and SLA policies visible with an Off badge while feature.sla is off", () => {
    permissions.settings = true;
    permissions.calendars = true;
    workspaceFeatureState.sla = false;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    for (const href of [
      "/dashboard/settings/workspace/sla-policies",
      "/dashboard/settings/workspace/calendars",
    ]) {
      const link = screen
        .getAllByRole("link")
        .find((a) => a.getAttribute("href") === href);
      expect(link).toBeTruthy();
      expect(
        within(link as HTMLElement).getByText("featureFlags:stateOff"),
      ).toBeTruthy();
    }
    const requestTypes = screen
      .getAllByRole("link")
      .find(
        (a) =>
          a.getAttribute("href") ===
          "/dashboard/settings/workspace/request-types",
      );
    expect(
      within(requestTypes as HTMLElement).queryByText("featureFlags:stateOff"),
    ).toBeNull();
  });

  it("shows the SLA entries without a badge when feature.sla is on", () => {
    permissions.calendars = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/dashboard/settings/workspace/sla-policies");
    expect(hrefs).toContain("/dashboard/settings/workspace/calendars");
    expect(screen.queryByText("featureFlags:stateOff")).toBeNull();
  });

  it("hides the SLA entries while the flags load, and from people without sla_policy:manage", () => {
    permissions.calendars = true;
    workspaceFeatureState.sla = false;
    workspaceFeatureState.loading = true;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    let hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/dashboard/settings/workspace/sla-policies");
    expect(hrefs).not.toContain("/dashboard/settings/workspace/calendars");
    cleanup();

    permissions.calendars = false;
    workspaceFeatureState.loading = false;
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/dashboard/settings/workspace/sla-policies");
    expect(hrefs).not.toContain("/dashboard/settings/workspace/calendars");
  });

  it("puts the settings menu in a named navigation landmark (UAT re-audit)", () => {
    render(<WorkspaceSettingsFrame>body</WorkspaceSettingsFrame>);
    const nav = screen.getByRole("navigation", {
      name: "navigation:page.settingsWorkspaceTab",
    });
    expect(within(nav).getAllByRole("link").length).toBe(
      screen.getAllByRole("link").length,
    );
  });
});
