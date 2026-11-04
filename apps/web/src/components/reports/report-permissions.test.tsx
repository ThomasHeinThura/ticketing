import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who is offered what on the report screens (UAT re-audit, 3 Nov): a role without
 * saved_view:create is never offered a save the API refuses, the builder never asks for team
 * audiences without saved_view:share, and with `feature.reports` off no screen asks for report
 * data or offers a way into a second "Reports are off" page.
 */
const state = vi.hoisted(() => ({
  caps: {} as Record<string, boolean>,
  checking: false,
  features: [{ key: "feature.reports", enabled: true }] as Array<{
    key: string;
    enabled: boolean;
  }>,
}));
const calls = vi.hoisted(() => ({
  teamAudiences: vi.fn(async () => [{ id: "team-1", name: "Support" }]),
  savedViews: vi.fn(async () => []),
  catalogue: vi.fn(),
  dashboards: vi.fn(),
  dashboard: vi.fn(),
  preview: vi.fn(),
  report: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "n" in options ? `${key} ${options.n}/${options.needed}` : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: state.checking,
    canCreateSavedViews: () => state.caps.createSavedViews === true,
    canShareSavedViews: () => state.caps.shareSavedViews === true,
    canManageWorkspaceSettings: () =>
      state.caps.manageWorkspaceSettings === true,
  }),
}));
vi.mock("@/fetchers/feature-flags", () => ({
  getWorkspaceResolvedFeatures: async () => state.features,
}));
vi.mock("@/fetchers/saved-views", () => ({
  createSavedView: vi.fn(),
  updateSavedView: vi.fn(),
  getSavedView: vi.fn(),
  getSavedViews: calls.savedViews,
  getShareableViewTeams: calls.teamAudiences,
}));
vi.mock("@/hooks/queries/custom-field/use-custom-fields", () => ({
  useCustomFields: () => ({ data: { data: [] } }),
}));
const idle = { data: undefined, isLoading: true, isError: false, error: null };
vi.mock("@/hooks/queries/report", () => ({
  reportKeys: { all: (id: string) => ["reports", id] },
  useReportCatalogue: (...args: unknown[]) => {
    calls.catalogue(...args);
    return idle;
  },
  useReport: (...args: unknown[]) => {
    calls.report(...args);
    return idle;
  },
  useCustomPreview: (...args: unknown[]) => {
    calls.preview(...args);
    return idle;
  },
  useDashboards: (...args: unknown[]) => {
    calls.dashboards(...args);
    return idle;
  },
  useDashboard: (...args: unknown[]) => {
    calls.dashboard(...args);
    return idle;
  },
}));

import { DashboardView } from "./dashboard-view";
import { ReportBuilder } from "./report-builder";
import { ReportsIndex } from "./reports-index";

function withClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const VIEWER = {};
const MEMBER = { createSavedViews: true };
const LEAD = { createSavedViews: true, shareSavedViews: true };

beforeEach(() => {
  state.caps = {};
  state.checking = false;
  state.features = [{ key: "feature.reports", enabled: true }];
  for (const fn of Object.values(calls)) fn.mockClear();
});
afterEach(cleanup);

describe("report builder save row (saved_view:create)", () => {
  it("never offers a viewer a save: it says so instead", async () => {
    state.caps = VIEWER;
    render(withClient(<ReportBuilder search={{}} />));
    expect(
      await screen.findByTestId("report-builder-read-only"),
    ).toHaveTextContent("reports:builder.readOnly");
    expect(
      screen.queryByRole("button", { name: "reports:builder.save" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "reports:builder.update" }),
    ).toBeNull();
  });

  it("does not offer opening a saved report for change to a viewer either", async () => {
    state.caps = VIEWER;
    render(withClient(<ReportBuilder search={{ view: "view-1" }} />));
    expect(
      await screen.findByTestId("report-builder-read-only"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "reports:builder.update" }),
    ).toBeNull();
  });

  it("offers a member the save row", async () => {
    state.caps = MEMBER;
    render(withClient(<ReportBuilder search={{}} />));
    expect(
      await screen.findByRole("button", { name: "reports:builder.save" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("report-builder-read-only")).toBeNull();
  });
});

describe("report builder audiences (saved_view:share)", () => {
  it("never asks for team audiences, nor offers a team, without saved_view:share", async () => {
    state.caps = MEMBER;
    render(withClient(<ReportBuilder search={{}} />));
    await screen.findByRole("button", { name: "reports:builder.save" });
    screen.getByRole("button", { name: "reports:builder.visibility" }).click();
    expect(
      await screen.findByRole("button", {
        name: "reports:builder.visibilities.private",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "reports:builder.visibilities.team",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "reports:builder.visibilities.workspace",
      }),
    ).toBeNull();
    expect(calls.teamAudiences).not.toHaveBeenCalled();
  });

  it("asks for team audiences only once a lead picks a team", async () => {
    state.caps = LEAD;
    render(withClient(<ReportBuilder search={{}} />));
    await screen.findByRole("button", { name: "reports:builder.save" });
    expect(calls.teamAudiences).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "reports:builder.visibility" }).click();
    (
      await screen.findByRole("button", {
        name: "reports:builder.visibilities.team",
      })
    ).click();
    await waitFor(() => expect(calls.teamAudiences).toHaveBeenCalledTimes(1));
  });
});

describe("reports index entry points", () => {
  it("hides 'New custom report' from a role that cannot save one", async () => {
    state.caps = VIEWER;
    render(withClient(<ReportsIndex search={{}} onSearchChange={vi.fn()} />));
    await waitFor(() => expect(calls.catalogue).toHaveBeenCalled());
    expect(screen.queryByText("reports:index.newCustom")).toBeNull();
  });

  it("shows 'New custom report' to a member", async () => {
    state.caps = MEMBER;
    render(withClient(<ReportsIndex search={{}} onSearchChange={vi.fn()} />));
    expect(
      await screen.findByText("reports:index.newCustom"),
    ).toBeInTheDocument();
  });
});

describe("feature.reports off", () => {
  it.each([
    [
      "reports index",
      () => <ReportsIndex search={{}} onSearchChange={vi.fn()} />,
      "reports:index.newCustom",
    ],
    [
      "dashboard",
      () => <DashboardView search={{}} onSearchChange={vi.fn()} />,
      "reports:dashboard.manage",
    ],
    ["builder", () => <ReportBuilder search={{}} />, "reports:builder.save"],
  ])(
    "%s shows the notice, asks for no report data and offers no way in",
    async (_name, screenOf, entryPoint) => {
      state.caps = LEAD;
      state.features = [{ key: "feature.reports", enabled: false }];
      render(withClient(screenOf()));
      expect(
        await screen.findByText("reports:errors.disabled.title"),
      ).toBeInTheDocument();
      expect(screen.queryByText(entryPoint)).toBeNull();
      expect(screen.queryByText("reports:dashboard.edit")).toBeNull();
      for (const fn of [
        calls.catalogue,
        calls.dashboards,
        calls.dashboard,
        calls.preview,
        calls.report,
        calls.savedViews,
      ])
        expect(fn).not.toHaveBeenCalled();
    },
  );

  it("never flashes the notice while the flag is still being read", () => {
    state.caps = LEAD;
    render(withClient(<DashboardView search={{}} onSearchChange={vi.fn()} />));
    expect(screen.getByTestId("reports-feature-loading")).toBeInTheDocument();
    expect(screen.queryByText("reports:errors.disabled.title")).toBeNull();
    expect(calls.dashboards).not.toHaveBeenCalled();
  });
});
