import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardWidget, ReportEnvelope } from "@/fetchers/report";

const widgetData = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));
vi.mock("@/hooks/queries/report", () => ({
  useWidgetData: () => widgetData.current,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && "n" in options)
        return `${key} ${options.n}/${options.needed}`;
      return options && typeof options.defaultValue === "string"
        ? options.defaultValue
        : key;
    },
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: string) => String(value).slice(0, 10),
  formatDateTime: (value: string) => String(value).slice(0, 16),
}));

import { DashboardWidgetCard } from "./dashboard-widget";

afterEach(cleanup);

const base: ReportEnvelope = {
  key: "throughput",
  title: "Throughput",
  category: "delivery",
  tier: 1,
  scope: { kind: "reach", projectCount: 2 },
  window: {
    preset: "30",
    from: "2026-09-25T00:00:00.000Z",
    to: "2026-10-24T09:30:00.000Z",
    days: 30,
    live: false,
  },
  asOf: "2026-10-24T09:30:00.000Z",
  boundary: "live",
  snapshot: null,
  filters: {},
  options: {},
  choices: [],
  metrics: [
    {
      key: "completed",
      label: "Items completed",
      unit: "count",
      value: 12,
      n: 12,
      needed: 0,
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: ["a", "b"],
    series: [{ key: "completed", label: "Completed", values: [5, 7] }],
  },
  columns: [
    { key: "week", label: "Week", kind: "date" },
    { key: "completed", label: "Completed", kind: "number" },
  ],
  rows: [
    { week: "2026-10-12", completed: 5 },
    { week: "2026-10-19", completed: 7 },
  ],
  truncated: false,
  empty: null,
  excluded: null,
  notes: [],
  drill: false,
  costVisible: false,
};

const widget = (chartType: DashboardWidget["chartType"]): DashboardWidget => ({
  id: "w1",
  reportKey: "throughput",
  savedViewId: null,
  chartType,
  filters: { window: "30" },
  x: 0,
  y: 0,
  w: 4,
  h: 2,
});

function show(data: ReportEnvelope, chartType: DashboardWidget["chartType"]) {
  widgetData.current = { data, isLoading: false, isError: false, error: null };
  return render(
    <DashboardWidgetCard
      workspaceId="w"
      dashboardId="d"
      version={1}
      widget={widget(chartType)}
    />,
  );
}

describe("a dashboard widget (RP-13)", () => {
  it("shows a number widget as the report's first metric, in the report's words", () => {
    show(base, "number");
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Items completed")).toBeTruthy();
    expect(screen.getByTestId("report-context").textContent).toContain(
      "reports:context.scopeReach",
    );
  });

  it("never turns a missing number into 0% (RP-1)", () => {
    show(
      {
        ...base,
        metrics: [
          {
            key: "attainment",
            label: "Attainment",
            unit: "percent",
            value: null,
            n: 3,
            needed: 10,
          },
        ],
      },
      "number",
    );
    expect(screen.getByText("reports:notEnoughData 3/10")).toBeTruthy();
  });

  it("gives a chart widget its table equivalent (RP-11)", () => {
    const { container } = show(base, "bar");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "reports:views.table" }),
    ).toBeTruthy();
  });

  it("is just the table for a table widget", () => {
    const { container } = show(base, "table");
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("shows an empty report as a dash with its explanation, not a chart of nothing (RP-5)", () => {
    const { container } = show(
      {
        ...base,
        chart: null,
        rows: [],
        empty: {
          reason: "no_data_in_window",
          outsideWindow: 4,
          excluded: null,
        },
      },
      "bar",
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("explains a refusal in words", () => {
    widgetData.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error("x"), { status: 403 }),
    };
    render(
      <DashboardWidgetCard
        workspaceId="w"
        dashboardId="d"
        version={1}
        widget={widget("bar")}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
