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
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  getTimer: vi.fn(),
  getTimeActivities: vi.fn(),
  getTimeEntries: vi.fn(),
  getHourlyRates: vi.fn(),
  getProjectBudget: vi.fn(),
  stopTimer: vi.fn(),
}));

import { BackdateLimitSetting, ProjectBillableSetting } from "./time-settings";

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
