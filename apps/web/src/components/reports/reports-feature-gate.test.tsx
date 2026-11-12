import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headingLevels } from "@/test/headings";

const state = vi.hoisted(() => ({
  reportsOn: false,
  canManageSettings: false,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children?: React.ReactNode;
  }) => (
    <a {...props} href={to}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => state.canManageSettings,
  }),
}));
vi.mock("@/fetchers/feature-flags", () => ({
  getWorkspaceResolvedFeatures: async () => [
    { key: "feature.reports", enabled: state.reportsOn },
  ],
}));

import { ReportsFeatureGate } from "./reports-feature-gate";

afterEach(() => {
  cleanup();
  state.reportsOn = false;
  state.canManageSettings = false;
});

function renderGate() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportsFeatureGate title="Reports">
        <p>Report content</p>
      </ReportsFeatureGate>
    </QueryClientProvider>,
  );
}

describe("ReportsFeatureGate (UX-1a, SR-02)", () => {
  it("renders the reports when the feature is on", async () => {
    state.reportsOn = true;
    renderGate();
    expect(await screen.findByText("Report content")).toBeInTheDocument();
  });

  it("shows the page title and the shared feature-off state, not an alert, when off", async () => {
    renderGate();
    expect(
      await screen.findByTestId("feature-off-reports"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("reports:errors.disabled.title"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("reports:errors.disabled.description"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Report content")).toBeNull();
    // One h1, the page title; the off state's title sits under it.
    expect(headingLevels()).toEqual([1, 2]);
  });

  it("offers Turn on in Features only to a workspace settings manager", async () => {
    state.canManageSettings = true;
    renderGate();
    expect(
      await screen.findByText("reports:errors.disabled.manageDescription"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "common:featureOff.turnOn" }),
    ).toHaveAttribute("href", "/dashboard/settings/workspace/features");
  });
});
