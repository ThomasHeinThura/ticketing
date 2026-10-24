import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetOverview } from "@/fetchers/time-tracking";

const mocks = vi.hoisted(() => ({ getProjectBudget: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.amounts ? `${key} ${options.amounts}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: unknown) => String(value),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/fetchers/time-tracking", () => {
  class TimeRuleError extends Error {
    code = "x";
  }
  return {
    TimeRuleError,
    TimeTrackingDisabledError: class extends Error {},
    getProjectBudget: (...args: unknown[]) => mocks.getProjectBudget(...args),
    createProjectBudget: vi.fn(),
    stopTimer: vi.fn(),
  };
});

import { ProjectBudget, percentSpent } from "./project-budget";

const base: BudgetOverview = {
  canManage: false,
  data: [
    {
      id: "b1",
      projectId: "p1",
      name: "Q4",
      currency: "EUR",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      plannedAmountMinor: 100_000,
      figuresHidden: false,
      actualMinor: 91_000,
      remainingMinor: 9_000,
      thresholdReached: 90,
      otherCurrencies: [
        { currency: "USD", costMinor: 5_000, pricedMinutes: 60 },
      ],
      unpricedMinutes: 90,
      committedMinor: null,
    },
  ],
  byActivity: [],
  byPerson: [],
};

function renderBudget() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectBudget projectId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getProjectBudget.mockResolvedValue(base);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("percentSpent", () => {
  it("is a whole percentage from integers, capped at 100", () => {
    expect(percentSpent(100_000, 91_000)).toBe(91);
    expect(percentSpent(3, 1)).toBe(33);
    expect(percentSpent(100, 250)).toBe(100);
    expect(percentSpent(0, 0)).toBe(0);
    expect(percentSpent(0, 5)).toBe(100);
  });
});

describe("ProjectBudget", () => {
  it("shows planned, actual and remaining money and the threshold reached", async () => {
    renderBudget();
    expect(await screen.findByTestId("budget-card")).toBeTruthy();
    expect(screen.getByText("1,000.00 EUR")).toBeTruthy();
    expect(screen.getByText("910.00 EUR")).toBeTruthy();
    expect(screen.getByText("90.00 EUR")).toBeTruthy();
    expect(screen.getByText("timeTracking:budget.threshold")).toBeTruthy();
    expect(
      screen.getByText("timeTracking:budget.committedUnavailable"),
    ).toBeTruthy();
  });

  it("reports other currencies apart, never converted", async () => {
    renderBudget();
    expect(await screen.findByText(/50\.00 USD/u)).toBeTruthy();
  });

  it("offers the create form only to budget managers and the minutes breakdowns only when returned", async () => {
    renderBudget();
    await screen.findByTestId("budget-card");
    expect(screen.queryByLabelText("timeTracking:budget.name")).toBeNull();
    expect(screen.queryByTestId("budget-by-activity")).toBeNull();
    cleanup();
    mocks.getProjectBudget.mockResolvedValue({
      ...base,
      canManage: true,
      byActivity: [{ key: "dev", label: "Development", minutes: 600 }],
    });
    renderBudget();
    expect(
      await screen.findByLabelText("timeTracking:budget.name"),
    ).toBeTruthy();
    expect(screen.getByTestId("budget-by-activity")).toBeTruthy();
  });

  it("renders a budget stripped of priced figures without crashing (TC-11)", async () => {
    const {
      actualMinor,
      remainingMinor,
      thresholdReached,
      otherCurrencies,
      unpricedMinutes,
      ...rest
    } = base.data[0] as Required<(typeof base.data)[number]>;
    void [
      actualMinor,
      remainingMinor,
      thresholdReached,
      otherCurrencies,
      unpricedMinutes,
    ];
    mocks.getProjectBudget.mockResolvedValue({
      ...base,
      data: [{ ...rest, figuresHidden: true }],
    });
    renderBudget();
    expect(await screen.findByTestId("budget-card")).toBeTruthy();
    expect(screen.getByText("1,000.00 EUR")).toBeTruthy();
    expect(
      screen.getAllByText("timeTracking:budget.figuresHidden"),
    ).toHaveLength(2);
    expect(screen.queryByText("timeTracking:budget.threshold")).toBeNull();
    expect(screen.queryByText(/USD/u)).toBeNull();
  });

  it("says plainly when the caller may not see the budget", async () => {
    mocks.getProjectBudget.mockImplementation(async () => {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    });
    renderBudget();
    expect(
      await screen.findByText("timeTracking:budget.forbiddenTitle"),
    ).toBeTruthy();
  });
});
