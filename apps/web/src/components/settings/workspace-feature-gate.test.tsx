import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headingLevels } from "@/test/headings";

const state = vi.hoisted(() => ({
  workspace: { id: "w1" } as { id: string } | undefined,
  workspaceLoading: false,
  sla: false,
  featuresLoading: false,
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
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => state.canManageSettings,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: state.workspace, isLoading: state.workspaceLoading }),
}));
vi.mock("@/hooks/queries/feature-flag/use-workspace-features", () => ({
  default: (workspaceId: string | undefined) => ({
    isOn: (key: string) =>
      workspaceId === "w1" && key === "feature.sla" && state.sla,
    isLoading: state.featuresLoading,
  }),
}));

import { WorkspaceFeatureGate } from "./workspace-feature-gate";

afterEach(() => {
  cleanup();
  Object.assign(state, {
    workspace: { id: "w1" },
    workspaceLoading: false,
    sla: false,
    featuresLoading: false,
    canManageSettings: false,
  });
});

const renderGate = () =>
  render(
    <WorkspaceFeatureGate
      feature="feature.sla"
      off="sla"
      title="SLA policies"
      description="Response and resolution targets."
    >
      <p>SLA policies list</p>
    </WorkspaceFeatureGate>,
  );

describe("WorkspaceFeatureGate (P4R2-M1)", () => {
  it("shows the standard feature-off state, not the area, when the flag is off", () => {
    renderGate();
    expect(screen.getByTestId("feature-off-sla")).toBeTruthy();
    expect(screen.getByText("featureOff.sla.title")).toBeTruthy();
    expect(screen.queryByText("SLA policies list")).toBeNull();
  });

  it("renders the area when the flag is on", () => {
    state.sla = true;
    renderGate();
    expect(screen.getByText("SLA policies list")).toBeTruthy();
    expect(screen.queryByTestId("feature-off-sla")).toBeNull();
  });

  it("renders nothing while the workspace or its flags are loading, so no area request fires", () => {
    state.featuresLoading = true;
    state.sla = true;
    const first = renderGate();
    expect(first.container).toBeEmptyDOMElement();
    cleanup();
    state.featuresLoading = false;
    state.workspace = undefined;
    state.workspaceLoading = true;
    const second = renderGate();
    expect(second.container).toBeEmptyDOMElement();
  });

  // UX-1a (S2, SR-05): the off page keeps its title and description, and only a settings
  // manager gets the link to the workspace feature settings.
  it("keeps the page title and description above the off state", () => {
    renderGate();
    expect(
      screen.getByRole("heading", { level: 1, name: "SLA policies" }),
    ).toBeTruthy();
    expect(screen.getByText("Response and resolution targets.")).toBeTruthy();
  });

  it("has one h1, the page title, with the off state's title under it as h2", () => {
    renderGate();
    expect(headingLevels()).toEqual([1, 2]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      within(screen.getByTestId("feature-off-sla")).getByRole("heading", {
        level: 2,
      }),
    ).toBeInTheDocument();
  });

  it("asks a non-manager to contact an admin and offers no link", () => {
    renderGate();
    expect(screen.getByText("featureOff.sla.description")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers a settings manager Turn on in Features", () => {
    state.canManageSettings = true;
    renderGate();
    expect(screen.getByText("featureOff.sla.manageDescription")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "common:featureOff.turnOn" })
        .getAttribute("href"),
    ).toBe("/dashboard/settings/workspace/features");
  });
});
