import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CostEntry, ProjectCosts } from "@/fetchers/time-tracking";
import type { WorkItemDetailRow } from "@/types/work-item";

const mocks = vi.hoisted(() => ({
  getProjectCosts: vi.fn(),
  createProjectCost: vi.fn(),
  requestCostEntryDeletion: vi.fn(),
  openPendingAction: vi.fn(),
  readBudgets: true,
  costOn: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canReadBudgets: () => mocks.readBudgets }),
}));
vi.mock("@/hooks/queries/time-tracking/use-time-tracking", () => ({
  timeKeys: { all: ["time-tracking"] },
  useTimeTrackingFeatures: () => ({
    time: true,
    cost: mocks.costOn,
    isLoading: false,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: unknown) => String(value),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/fetchers/time-tracking", () => {
  class TimeRuleError extends Error {
    code = "x";
  }
  return {
    TimeRuleError,
    TimeTrackingDisabledError: class extends Error {},
    getProjectCosts: (...args: unknown[]) => mocks.getProjectCosts(...args),
    createProjectCost: (...args: unknown[]) => mocks.createProjectCost(...args),
    requestCostEntryDeletion: (...args: unknown[]) =>
      mocks.requestCostEntryDeletion(...args),
    updateCostEntry: vi.fn(),
    stopTimer: vi.fn(),
  };
});

import WorkItemCosts from "./work-item-costs";

const item = {
  id: "wi1",
  projectId: "p1",
  workspaceId: "w1",
  key: "HELP-1",
} as WorkItemDetailRow;

const seat = {
  id: "ct1",
  workspaceId: "w1",
  name: "Seat",
  unit: "seat",
  defaultRateMinor: 1250,
  currency: "EUR",
  billable: true,
  archived: false,
};

function entry(over: Partial<CostEntry> = {}): CostEntry {
  return {
    id: "c1",
    workspaceId: "w1",
    projectId: "p1",
    workItemId: "wi1",
    workItemKey: "HELP-1",
    workItemTitle: "First",
    costTypeId: "ct1",
    costTypeName: "Seat",
    unit: "seat",
    personId: "me",
    personName: "Me",
    date: "2026-10-21",
    units: 3,
    currency: "EUR",
    billable: true,
    note: "Licences",
    createdAt: "2026-10-21T08:00:00Z",
    updatedAt: "2026-10-21T08:00:00Z",
    ...over,
  };
}

function costs(over: Partial<ProjectCosts> = {}): ProjectCosts {
  return {
    data: [entry({ rateMinor: 1250, amountMinor: 3750 })],
    canManage: true,
    costTypes: [seat],
    totals: [{ currency: "EUR", amountMinor: 3750, entryCount: 1 }],
    entryCount: 1,
    canLogBackdated: false,
    backdateLimitDays: 30,
    callerPersonId: "me",
    today: "2026-10-21",
    ...over,
  };
}

function renderCosts() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WorkItemCosts item={item} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.readBudgets = true;
  mocks.costOn = true;
  mocks.getProjectCosts.mockResolvedValue(costs());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkItemCosts", () => {
  it("is hidden without budget:read or with cost tracking off, and asks for nothing", async () => {
    mocks.readBudgets = false;
    const view = renderCosts();
    expect(
      view.container.querySelector("[data-testid=work-item-costs]"),
    ).toBeNull();
    view.unmount();
    mocks.readBudgets = true;
    mocks.costOn = false;
    const second = renderCosts();
    expect(
      second.container.querySelector("[data-testid=work-item-costs]"),
    ).toBeNull();
    expect(mocks.getProjectCosts).not.toHaveBeenCalled();
  });

  it("shows amounts, per-currency totals and the quick-add to rate managers", async () => {
    renderCosts();
    expect(await screen.findAllByTestId("cost-entry-row")).toHaveLength(1);
    expect(screen.getAllByText("37.50 EUR")).toHaveLength(2);
    expect(screen.getByTestId("cost-total").textContent).toBe("37.50 EUR");
    expect(screen.getByText("3 seat")).toBeTruthy();
    expect(screen.getByLabelText("timeTracking:costs.edit")).toBeTruthy();
    expect(screen.getByLabelText("timeTracking:costs.delete")).toBeTruthy();
    expect(mocks.getProjectCosts).toHaveBeenCalledWith("p1", {
      workItemId: "wi1",
    });
  });

  it("renders without any amount or action when the API withholds them", async () => {
    mocks.getProjectCosts.mockResolvedValue({
      data: [entry()],
      canManage: false,
      entryCount: 1,
      canLogBackdated: false,
      backdateLimitDays: 30,
      callerPersonId: "me",
      today: "2026-10-21",
    });
    renderCosts();
    expect(await screen.findAllByTestId("cost-entry-row")).toHaveLength(1);
    expect(screen.getByText("3 seat")).toBeTruthy();
    expect(screen.queryByText(/EUR/u)).toBeNull();
    expect(screen.queryByTestId("cost-total")).toBeNull();
    expect(screen.queryByLabelText("timeTracking:costs.edit")).toBeNull();
    expect(screen.queryByLabelText("timeTracking:costs.delete")).toBeNull();
    expect(screen.queryByLabelText("timeTracking:costs.type")).toBeNull();
  });

  it("quick-add posts units, the work item and the date; the type's rate is left to the server", async () => {
    mocks.createProjectCost.mockResolvedValue(entry());
    renderCosts();
    const units = await screen.findByLabelText("timeTracking:costs.units");
    fireEvent.change(units, { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("timeTracking:costs.note"), {
      target: { value: " Extra seats " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:costs.add" }),
    );
    await waitFor(() =>
      expect(mocks.createProjectCost).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createProjectCost).toHaveBeenCalledWith("p1", {
      costTypeId: "ct1",
      workItemId: "wi1",
      date: "2026-10-21",
      units: 4,
      note: "Extra seats",
    });
  });

  it("asks for a rate in minor units when the type has no default", async () => {
    mocks.getProjectCosts.mockResolvedValue(
      costs({ costTypes: [{ ...seat, defaultRateMinor: null }] }),
    );
    mocks.createProjectCost.mockResolvedValue(entry());
    renderCosts();
    const add = (await screen.findByRole("button", {
      name: "timeTracking:costs.add",
    })) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("timeTracking:costs.rate"), {
      target: { value: "19.99" },
    });
    fireEvent.click(add);
    await waitFor(() =>
      expect(mocks.createProjectCost).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createProjectCost.mock.calls[0]?.[1]).toMatchObject({
      units: 1,
      rateMinor: 1999,
    });
  });

  it("will not log units that are not whole numbers", async () => {
    renderCosts();
    fireEvent.change(await screen.findByLabelText("timeTracking:costs.units"), {
      target: { value: "1.5" },
    });
    const add = screen.getByRole("button", {
      name: "timeTracking:costs.add",
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
  });

  it("deleting opens the pending-action approval", async () => {
    mocks.requestCostEntryDeletion.mockResolvedValue({
      pendingActionId: "pa1",
    });
    renderCosts();
    fireEvent.click(await screen.findByLabelText("timeTracking:costs.delete"));
    await waitFor(() =>
      expect(mocks.requestCostEntryDeletion).toHaveBeenCalledWith("c1"),
    );
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa1",
      }),
    );
  });
});
