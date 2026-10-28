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
  getCostTypes: vi.fn(),
  createCostType: vi.fn(),
  updateCostType: vi.fn(),
  canManageRates: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageRates: () => mocks.canManageRates,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/time-tracking/use-time-tracking", () => ({
  timeKeys: { all: ["time-tracking"] },
}));
vi.mock("@/fetchers/time-tracking", () => ({
  TimeRuleError: class extends Error {},
  TimeTrackingDisabledError: class extends Error {},
  getCostTypes: (...args: unknown[]) => mocks.getCostTypes(...args),
  createCostType: (...args: unknown[]) => mocks.createCostType(...args),
  updateCostType: (...args: unknown[]) => mocks.updateCostType(...args),
  stopTimer: vi.fn(),
}));

import { CostTypesSection } from "./cost-types-settings";

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

function renderSection() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CostTypesSection workspaceId="w1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canManageRates = true;
  mocks.getCostTypes.mockResolvedValue([seat]);
  mocks.createCostType.mockResolvedValue(seat);
  mocks.updateCostType.mockResolvedValue(seat);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CostTypesSection", () => {
  it("renders nothing and fetches nothing without time_entry:manage_rates", () => {
    mocks.canManageRates = false;
    const view = renderSection();
    expect(view.container.firstChild).toBeNull();
    expect(mocks.getCostTypes).not.toHaveBeenCalled();
  });

  it("lists the types with the default rate in money", async () => {
    renderSection();
    expect(await screen.findAllByTestId("cost-type-row")).toHaveLength(1);
    expect(screen.getByText("12.50 EUR")).toBeTruthy();
    expect(mocks.getCostTypes).toHaveBeenCalledWith("w1", true);
  });

  it("adds a type with the default rate in integer minor units", async () => {
    renderSection();
    await screen.findAllByTestId("cost-type-row");
    fireEvent.change(document.getElementById("cost-type-new-name") as Element, {
      target: { value: " Mileage " },
    });
    fireEvent.change(document.getElementById("cost-type-new-unit") as Element, {
      target: { value: "km" },
    });
    fireEvent.change(document.getElementById("cost-type-new-rate") as Element, {
      target: { value: "0.65" },
    });
    fireEvent.change(
      document.getElementById("cost-type-new-currency") as Element,
      { target: { value: "eur" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:costTypes.add" }),
    );
    await waitFor(() => expect(mocks.createCostType).toHaveBeenCalledTimes(1));
    expect(mocks.createCostType).toHaveBeenCalledWith({
      workspaceId: "w1",
      name: "Mileage",
      unit: "km",
      defaultRateMinor: 65,
      currency: "EUR",
      billable: true,
    });
  });

  it("sends null when no default rate is given", async () => {
    renderSection();
    await screen.findAllByTestId("cost-type-row");
    fireEvent.change(document.getElementById("cost-type-new-name") as Element, {
      target: { value: "Hotel" },
    });
    fireEvent.change(
      document.getElementById("cost-type-new-currency") as Element,
      { target: { value: "USD" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:costTypes.add" }),
    );
    await waitFor(() => expect(mocks.createCostType).toHaveBeenCalledTimes(1));
    expect(mocks.createCostType.mock.calls[0]?.[0]).toMatchObject({
      name: "Hotel",
      unit: "unit",
      defaultRateMinor: null,
      currency: "USD",
    });
  });

  it("archives and restores a type through PATCH archived", async () => {
    renderSection();
    fireEvent.click(
      await screen.findByLabelText("timeTracking:costTypes.archiveLabel"),
    );
    await waitFor(() =>
      expect(mocks.updateCostType).toHaveBeenCalledWith("ct1", "w1", {
        archived: true,
      }),
    );
    cleanup();
    mocks.getCostTypes.mockResolvedValue([{ ...seat, archived: true }]);
    renderSection();
    fireEvent.click(
      await screen.findByLabelText("timeTracking:costTypes.restoreLabel"),
    );
    await waitFor(() =>
      expect(mocks.updateCostType).toHaveBeenLastCalledWith("ct1", "w1", {
        archived: false,
      }),
    );
  });

  it("edits only what changed", async () => {
    renderSection();
    fireEvent.click(
      await screen.findByLabelText("timeTracking:costTypes.edit"),
    );
    const rate = (await waitFor(() => {
      const el = document.getElementById("cost-type-edit-rate");
      if (!el) throw new Error("dialog not open");
      return el;
    })) as HTMLInputElement;
    expect(rate.value).toBe("12.50");
    fireEvent.change(rate, { target: { value: "15" } });
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:actions.save" }),
    );
    await waitFor(() =>
      expect(mocks.updateCostType).toHaveBeenCalledWith("ct1", "w1", {
        defaultRateMinor: 1500,
      }),
    );
  });
});
