import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UAT re-audit: workspace settings opened by URL by a role that cannot read them showed
 * contradictory error states and logged 403s. Each screen now resolves the capability its read
 * route requires first, shows one access notice, and never sends the request.
 */
const mocks = vi.hoisted(() => ({
  canLogTime: false,
  canManageRates: false,
  canManageWorkspaceSettings: false,
  checking: false,
  rateError: null as Error | null,
  activities: [] as Array<{ id: string; name: string; archived: boolean }>,
  useTimeEntries: vi.fn(),
  useTimeActivities: vi.fn(),
  useHourlyRates: vi.fn(),
  useTimeSettings: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" }, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canLogTime: () => mocks.canLogTime,
    canManageRates: () => mocks.canManageRates,
    canManageWorkspaceSettings: () => mocks.canManageWorkspaceSettings,
    isCheckingPermissions: mocks.checking,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/time-tracking/use-time-tracking", () => ({
  useTimeEntries: (...args: unknown[]) => {
    mocks.useTimeEntries(...args);
    return { data: undefined, isLoading: false };
  },
  useTimeActivities: (...args: unknown[]) => {
    mocks.useTimeActivities(...args);
    return {
      data: mocks.activities,
      isLoading: false,
      isError: false,
      error: null,
    };
  },
  useHourlyRates: (...args: unknown[]) => {
    mocks.useHourlyRates(...args);
    return {
      data: { data: [], people: [] },
      isLoading: false,
      isError: mocks.rateError !== null,
      error: mocks.rateError,
    };
  },
  useTimeSettings: (...args: unknown[]) => {
    mocks.useTimeSettings(...args);
    return { data: undefined, isLoading: true };
  },
}));
vi.mock("./time-settings", () => ({
  BackdateLimitSetting: () => null,
  AvailableHoursSetting: () => null,
}));
vi.mock("./cost-types-settings", () => ({ CostTypesSection: () => null }));

import { RatesSettings } from "./rates-settings";
import { TimeActivitiesSettings } from "./time-activities-settings";

function renderWithClient(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      {node}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canLogTime = false;
  mocks.canManageRates = false;
  mocks.canManageWorkspaceSettings = false;
  mocks.checking = false;
  mocks.rateError = null;
  mocks.activities = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Rates settings access", () => {
  it("shows one access notice and never reads rates or time entries without manage_rates", () => {
    renderWithClient(<RatesSettings />);
    expect(screen.getByTestId("settings-access-denied")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "states.noAccess.title",
      }),
    ).toBeInTheDocument();
    expect(mocks.useHourlyRates).not.toHaveBeenCalled();
    expect(mocks.useTimeEntries).not.toHaveBeenCalled();
  });

  it("waits for the capability check instead of flashing the notice", () => {
    mocks.checking = true;
    renderWithClient(<RatesSettings />);
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
    expect(mocks.useHourlyRates).not.toHaveBeenCalled();
  });

  it("shows the no-access page when the rates read returns 403", () => {
    mocks.canManageRates = true;
    mocks.rateError = Object.assign(new Error("Forbidden"), { status: 403 });
    renderWithClient(<RatesSettings />);
    expect(
      screen.getByRole("heading", { level: 1, name: "states.noAccess.title" }),
    ).toHaveFocus();
  });

  it("loads rates for a role that manages them", () => {
    mocks.canManageRates = true;
    renderWithClient(<RatesSettings />);
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
    expect(mocks.useHourlyRates).toHaveBeenCalledWith("ws-1");
  });
});

describe("Time activities settings access", () => {
  it("shows one access notice, not 'Could not load the activity types', without time_entry:create", () => {
    renderWithClient(<TimeActivitiesSettings />);
    expect(screen.getByTestId("settings-access-denied")).toBeInTheDocument();
    expect(
      screen.queryByText("timeTracking:activities.loadError"),
    ).not.toBeInTheDocument();
    expect(mocks.useTimeActivities).not.toHaveBeenCalled();
  });

  it.each(["member", "lead"])(
    "shows activity names without edit controls to a %s",
    () => {
      mocks.canLogTime = true;
      mocks.activities = [{ id: "a1", name: "Support", archived: false }];
      renderWithClient(<TimeActivitiesSettings />);
      expect(screen.getByText("Support")).toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", {
          name: "timeTracking:activities.nameLabel",
        }),
      ).toBeNull();
      expect(screen.queryByRole("switch")).toBeNull();
      expect(screen.queryByText("timeTracking:activities.add")).toBeNull();
    },
  );

  it("loads the activities for a role that logs time", () => {
    mocks.canLogTime = true;
    renderWithClient(<TimeActivitiesSettings />);
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
    expect(mocks.useTimeActivities).toHaveBeenCalledWith("ws-1", true);
  });
});
