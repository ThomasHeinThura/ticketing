import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const items = vi.hoisted(() => ({
  data: { data: [] as unknown[] },
  isLoading: false,
  isError: false,
}));
vi.mock("@/hooks/queries/report", () => ({
  useWidgetData: () => widgetData.current,
  useWidgetItems: () => items,
  useReportExport: () => ({ data: undefined, isError: false }),
}));
vi.mock("@/fetchers/report", () => ({
  exportWidget: vi.fn().mockResolvedValue({
    kind: "file",
    filename: "w.csv",
    blob: new Blob(["a"]),
  }),
  downloadReportExport: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.defaultValue === "string"
        ? options.defaultValue
        : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: string) => String(value).slice(0, 10),
  formatDateTime: (value: string) => String(value).slice(0, 16),
}));

import { LiveWidgetCard } from "./dashboard-widget-live";

afterEach(cleanup);

const report = {
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
  metrics: [],
  chart: null,
  columns: [{ key: "week", label: "Week", kind: "date" }],
  rows: [{ week: "2026-10-12", _drill: "2026-10-12" }],
  truncated: false,
  empty: null,
  excluded: null,
  notes: [],
  drill: true,
  costVisible: false,
} as ReportEnvelope;

const widget: DashboardWidget = {
  id: "w1",
  reportKey: "throughput",
  savedViewId: null,
  chartType: "table",
  filters: { window: "30" },
  x: 0,
  y: 0,
  w: 4,
  h: 2,
};

function show(canExport: boolean) {
  widgetData.current = {
    data: report,
    isLoading: false,
    isError: false,
    error: null,
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LiveWidgetCard
        workspaceId="w"
        dashboardId="d"
        version={1}
        widget={widget}
        canExport={canExport}
      />
    </QueryClientProvider>,
  );
}

describe("a widget on a viewed dashboard (RP-10, RP-12)", () => {
  it("offers export only to someone who may export", () => {
    show(false);
    expect(
      screen.queryByRole("button", { name: "reports:dashboard.exportWidget" }),
    ).toBeNull();
    cleanup();
    show(true);
    expect(
      screen.getByRole("button", { name: "reports:dashboard.exportWidget" }),
    ).toBeTruthy();
  });

  it("opens the items behind a row of the widget", () => {
    show(true);
    fireEvent.click(screen.getByRole("button", { name: "reports:drill.open" }));
    expect(screen.getByText("reports:drill.empty")).toBeTruthy();
  });
});
