import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTimeSettings: vi.fn(),
  updateTimeSettings: vi.fn(),
  getAvailableHours: vi.fn(),
  createAvailableHours: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: unknown) => String(value),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/fetchers/time-tracking", () => ({
  TimeRuleError: class extends Error {},
  TimeTrackingDisabledError: class extends Error {},
  getTimeSettings: (...args: unknown[]) => mocks.getTimeSettings(...args),
  updateTimeSettings: (...args: unknown[]) => mocks.updateTimeSettings(...args),
  getAvailableHours: (...args: unknown[]) => mocks.getAvailableHours(...args),
  createAvailableHours: (...args: unknown[]) =>
    mocks.createAvailableHours(...args),
  getTimer: vi.fn(),
  getTimeActivities: vi.fn(),
  getTimeEntries: vi.fn(),
  getHourlyRates: vi.fn(),
  getProjectBudget: vi.fn(),
  stopTimer: vi.fn(),
}));

import {
  AvailableHoursSetting,
  BackdateLimitSetting,
  ProjectBillableSetting,
} from "./time-settings";

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getTimeSettings.mockResolvedValue({
    backdateLimitDays: 30,
    canManage: true,
    project: { id: "p1", defaultBillable: true },
  });
  mocks.updateTimeSettings.mockResolvedValue({});
  mocks.getAvailableHours.mockResolvedValue({
    data: [
      {
        id: "h1",
        personId: "me",
        personName: "Me",
        minutesPerWeek: 2400,
        effectiveFrom: "2026-01-01",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    canManage: true,
    people: [
      { personId: "me", name: "Me" },
      { personId: "ann", name: "Ann" },
    ],
    callerPersonId: "me",
  });
  mocks.createAvailableHours.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BackdateLimitSetting", () => {
  it("saves a whole number of days", async () => {
    wrap(<BackdateLimitSetting />);
    const input = (await screen.findByLabelText(
      "timeTracking:settings.backdateLimit",
    )) as HTMLInputElement;
    expect(input.value).toBe("30");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:actions.save" }),
    );
    await waitFor(() =>
      expect(mocks.updateTimeSettings).toHaveBeenCalledWith({
        workspaceId: "w1",
        backdateLimitDays: 7,
      }),
    );
  });

  it("will not save a value that is not whole days", async () => {
    wrap(<BackdateLimitSetting />);
    const input = await screen.findByLabelText(
      "timeTracking:settings.backdateLimit",
    );
    fireEvent.change(input, { target: { value: "1.5" } });
    const save = screen.getByRole("button", {
      name: "timeTracking:actions.save",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "4000" } });
    expect(save.disabled).toBe(true);
  });

  it("is read-only without workspace:manage_settings", async () => {
    mocks.getTimeSettings.mockResolvedValue({
      backdateLimitDays: 30,
      canManage: false,
      project: null,
    });
    wrap(<BackdateLimitSetting />);
    const input = (await screen.findByLabelText(
      "timeTracking:settings.backdateLimit",
    )) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: "timeTracking:actions.save" }),
    ).toBeNull();
  });
});

describe("ProjectBillableSetting", () => {
  it("changes the project's billable default", async () => {
    wrap(<ProjectBillableSetting projectId="p1" />);
    const toggle = await screen.findByRole("switch");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mocks.updateTimeSettings).toHaveBeenCalledWith({
        workspaceId: "w1",
        project: { id: "p1", defaultBillable: false },
      }),
    );
  });

  it("renders nothing when the project cannot be read", async () => {
    mocks.getTimeSettings.mockResolvedValue({
      backdateLimitDays: 30,
      canManage: true,
      project: null,
    });
    const view = wrap(<ProjectBillableSetting projectId="p1" />);
    await waitFor(() => expect(mocks.getTimeSettings).toHaveBeenCalled());
    expect(view.container.querySelector("[role=switch]")).toBeNull();
  });
});

describe("AvailableHoursSetting", () => {
  it("lists the history and posts hours per week as integer minutes", async () => {
    wrap(<AvailableHoursSetting />);
    expect(await screen.findAllByTestId("available-hours-row")).toHaveLength(1);
    expect(screen.getByText("40:00")).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("timeTracking:availableHours.hoursPerWeek", {
        selector: "input",
      }),
      { target: { value: "37.5" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:availableHours.add" }),
    );
    await waitFor(() =>
      expect(mocks.createAvailableHours).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createAvailableHours).toHaveBeenCalledWith({
      workspaceId: "w1",
      personId: "me",
      minutesPerWeek: 2250,
      effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    });
  });

  it("will not post text that is not hours", async () => {
    wrap(<AvailableHoursSetting />);
    const input = await screen.findByLabelText(
      "timeTracking:availableHours.hoursPerWeek",
      { selector: "input" },
    );
    fireEvent.change(input, { target: { value: "lots" } });
    const add = screen.getByRole("button", {
      name: "timeTracking:availableHours.add",
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "169" } });
    expect(add.disabled).toBe(true);
  });

  it("is hidden from people without workspace:manage_settings", async () => {
    mocks.getTimeSettings.mockResolvedValue({
      backdateLimitDays: 30,
      canManage: false,
      project: null,
    });
    const view = wrap(<AvailableHoursSetting />);
    await waitFor(() => expect(mocks.getTimeSettings).toHaveBeenCalled());
    expect(
      view.container.querySelector("[data-testid=available-hours]"),
    ).toBeNull();
    expect(mocks.getAvailableHours).not.toHaveBeenCalled();
  });
});
