import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headingLevels } from "@/test/headings";

const mocks = vi.hoisted(() => ({
  enabled: false as boolean | undefined,
  statusLoading: false,
  canManageSettings: false,
  calendarWorkspace: vi.fn(),
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
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/i18n/agent-translation", () => ({
  getDefaultAgentTerm: () => "Changes",
}));
vi.mock("@/lib/format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/format")>()),
  formatDateTime: (value: string) => value,
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => 1,
}));
vi.mock("@/lib/server-clock", () => ({
  useServerToday: () => new Date("2026-11-09T00:00:00Z"),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => mocks.canManageSettings,
  }),
}));
vi.mock("@/hooks/queries/service-management", () => ({
  useCatalogueStatus: () => ({
    data: mocks.statusLoading
      ? undefined
      : { enabled: mocks.enabled, canManageChanges: true },
    isLoading: mocks.statusLoading,
    isError: false,
  }),
  useChangeCalendar: (workspaceId: string) => {
    mocks.calendarWorkspace(workspaceId);
    return { data: undefined, isError: false };
  },
  useFreezes: () => ({ data: [], isLoading: false, isError: false }),
  useFreezeOverrides: () => ({ data: [], isLoading: false, isError: false }),
  useInvalidateServiceManagement: () => vi.fn(),
  isFeatureDisabled: () => false,
}));

import { ChangeCalendarView } from "./change-calendar";

afterEach(() => {
  cleanup();
  mocks.enabled = false;
  mocks.statusLoading = false;
  mocks.canManageSettings = false;
  mocks.calendarWorkspace.mockClear();
});

// UX-1a (SR-03): with the catalogue off the shared off state replaces the sub-tabs, the calendar
// chrome and the legend; the section tabs stay.
describe("ChangeCalendarView with the catalogue off", () => {
  it("shows the off state before any calendar chrome and asks for no calendar", () => {
    render(<ChangeCalendarView search={{}} />);
    expect(screen.getAllByTestId("service-catalogue-off")).toHaveLength(1);
    // One h1, the page title; the off state's title sits under it as h2.
    expect(headingLevels()).toEqual([1, 2]);
    expect(
      screen.getByRole("navigation", { name: "nav.title" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByLabelText("calendar.legend.title")).toBeNull();
    expect(mocks.calendarWorkspace).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: "common:featureOff.turnOn" }),
    ).toBeNull();
  });

  it("offers a settings manager Turn on in Features", () => {
    mocks.canManageSettings = true;
    render(<ChangeCalendarView search={{}} />);
    expect(
      screen.getByRole("link", { name: "common:featureOff.turnOn" }),
    ).toHaveAttribute("href", "/dashboard/settings/workspace/features");
  });

  it("shows the sub-tabs once the catalogue is on", () => {
    mocks.enabled = true;
    render(<ChangeCalendarView search={{}} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.queryByTestId("service-catalogue-off")).toBeNull();
  });

  it("shows neither calendar chrome nor a calendar request while the catalogue status loads", () => {
    mocks.statusLoading = true;
    render(<ChangeCalendarView search={{}} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("service-catalogue-off")).toBeNull();
    expect(mocks.calendarWorkspace).not.toHaveBeenCalled();
  });
});
