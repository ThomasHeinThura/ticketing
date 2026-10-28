import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspace: { id: "w1" } as { id: string } | undefined,
  workspaceLoading: false,
  sla: false,
  featuresLoading: false,
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
  });
});

const renderGate = () =>
  render(
    <WorkspaceFeatureGate feature="feature.sla" off="sla">
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
});
