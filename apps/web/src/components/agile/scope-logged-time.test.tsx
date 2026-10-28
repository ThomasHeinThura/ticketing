import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTimeSummary: vi.fn(),
  timeOn: true,
  canLog: true,
  checking: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/time-tracking/use-time-tracking", () => ({
  useTimeTrackingFeatures: () => ({
    time: mocks.timeOn,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canLogTime: () => mocks.canLog,
    isCheckingPermissions: mocks.checking,
  }),
}));
vi.mock("@/fetchers/time-tracking", () => ({
  getTimeSummary: (...args: unknown[]) => mocks.getTimeSummary(...args),
}));

import { ScopeLoggedTime } from "./scope-logged-time";

function renderSummary(scope: { cycleId: string } | { moduleId: string }) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <ScopeLoggedTime workspaceId="w1" projectId="p1" scope={scope} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.getTimeSummary.mockReset();
  mocks.timeOn = true;
  mocks.canLog = true;
  mocks.checking = false;
});

describe("ScopeLoggedTime", () => {
  it("loads and formats a cycle roll-up from the persisted summary API", async () => {
    mocks.getTimeSummary.mockResolvedValue({ totalMinutes: 95 });
    renderSummary({ cycleId: "c1" });
    expect(await screen.findByTestId("cycle-logged-time")).toBeTruthy();
    expect(screen.getByText("timeTracking:section.total")).toBeTruthy();
    expect(screen.getByText("1:35")).toBeTruthy();
    expect(mocks.getTimeSummary).toHaveBeenCalledWith({
      workspaceId: "w1",
      cycleId: "c1",
    });
  });

  it("queries the module roll-up and hides it when the time capability is absent", async () => {
    mocks.getTimeSummary.mockResolvedValue({ totalMinutes: 30 });
    const view = renderSummary({ moduleId: "m1" });
    expect(await screen.findByTestId("module-logged-time")).toBeTruthy();
    expect(mocks.getTimeSummary).toHaveBeenCalledWith({
      workspaceId: "w1",
      moduleId: "m1",
    });
    view.unmount();

    mocks.getTimeSummary.mockClear();
    mocks.canLog = false;
    renderSummary({ moduleId: "m2" });
    expect(screen.queryByTestId("module-logged-time")).toBeNull();
    expect(mocks.getTimeSummary).not.toHaveBeenCalled();
  });
});
