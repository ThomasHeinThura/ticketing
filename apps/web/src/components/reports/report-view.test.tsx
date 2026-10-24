import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportEnvelope } from "@/fetchers/report";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && "n" in options)
        return `${key} ${options.n}/${options.needed}`;
      if (options && "count" in options) return `${key} ${options.count}`;
      return options &&
        typeof options.defaultValue === "string" &&
        options.defaultValue
        ? options.defaultValue
        : key;
    },
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: string) => String(value).slice(0, 10),
  formatDateTime: (value: string) => String(value).slice(0, 16),
}));

import { ReportDrillDialog } from "./report-drill";
import { ReportTable } from "./report-table";
import {
  ReportContextLine,
  ReportEmpty,
  ReportMetrics,
  ReportNotes,
  ReportVisual,
} from "./report-view";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
const items = vi.hoisted(() => ({
  data: { data: [] as unknown[] },
  isLoading: false,
  isError: false,
}));
vi.mock("@/hooks/queries/report", () => ({
  useReportItems: () => items,
}));

afterEach(cleanup);

function report(overrides: Partial<ReportEnvelope> = {}): ReportEnvelope {
  return {
    key: "sla_attainment",
    title: "SLA attainment",
    category: "promises",
    tier: 1,
    scope: { kind: "reach", projectCount: 3 },
    window: {
      preset: "30",
      from: "2026-09-25T00:00:00.000Z",
      to: "2026-10-24T09:30:00.000Z",
      days: 30,
      live: false,
    },
    asOf: "2026-10-24T09:30:00.000Z",
    boundary: "live",
    filters: {},
    options: {},
    choices: [],
    metrics: [
      {
        key: "attainment",
        label: "Attainment",
        unit: "percent",
        value: null,
        n: 3,
        needed: 10,
      },
      { key: "met", label: "Met", unit: "count", value: 3, n: 3, needed: 0 },
    ],
    chart: {
      type: "bar",
      unit: "count",
      categories: ["urgent", "high"],
      series: [{ key: "met", label: "Met", values: [2, 1] }],
    },
    columns: [
      { key: "priority", label: "Priority", kind: "text" },
      { key: "met", label: "Met", kind: "number" },
      { key: "attainment", label: "Attainment", kind: "percent" },
    ],
    rows: [
      {
        priority: "urgent",
        met: 2,
        attainment: { n: 3, needed: 10 },
        _drill: "urgent",
      },
      { priority: "high", met: 1, attainment: null },
    ],
    truncated: false,
    empty: null,
    excluded: null,
    notes: [],
    drill: true,
    costVisible: false,
    ...overrides,
  };
}

describe("the honesty rule on screen", () => {
  it("shows 'not enough data (3 of 10)', never 0% or 100% or a blank (RP-1)", () => {
    render(<ReportMetrics metrics={report().metrics} empty={false} />);
    expect(screen.getByText("reports:notEnoughData 3/10")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("100%")).toBeNull();
  });

  it("states scope, window, as-of time and that it is computed live (RP-3, RP-4, RP-9)", () => {
    render(<ReportContextLine report={report()} />);
    const line = screen.getByTestId("report-context").textContent ?? "";
    expect(line).toContain("reports:context.scopeReach 3");
    expect(line).toContain("reports:context.window");
    expect(line).toContain("reports:context.asOf");
    expect(line).toContain("reports:context.live");
  });

  it("says a live report is live instead of naming a window", () => {
    render(
      <ReportContextLine
        report={report({ window: { ...report().window, live: true } })}
      />,
    );
    expect(screen.getByTestId("report-context").textContent).toContain(
      "reports:context.windowLive",
    );
  });

  it("says when a trend cannot be drawn (RP-6)", () => {
    render(
      <ReportMetrics
        empty={false}
        metrics={[
          {
            key: "attainment",
            label: "Attainment",
            unit: "percent",
            value: 80,
            n: 12,
            needed: 10,
            trend: { status: "insufficient", reason: "needs_two_periods" },
          },
          {
            key: "met",
            label: "Met",
            unit: "count",
            value: 3,
            n: 3,
            needed: 0,
            trend: { status: "ok", direction: "up", delta: 2, previous: 1 },
          },
        ]}
      />,
    );
    expect(screen.getByText("reports:trend.insufficient")).toBeTruthy();
    expect(screen.getByText("reports:trend.up")).toBeTruthy();
  });

  it("shows an empty report as a dash with an explanation, and no chart (RP-5)", () => {
    const empty = report({
      empty: { reason: "no_data_in_window", outsideWindow: 7, excluded: null },
      chart: null,
      rows: [],
    });
    const { container } = render(
      <>
        <ReportEmpty report={empty} />
        <ReportVisual report={empty} view={undefined} />
      </>,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("reports:empty.noDataInWindow 7")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });

  it("renders the notes it was given", () => {
    render(<ReportNotes notes={["sla_policy_changed"]} />);
    expect(screen.getByRole("alert").textContent).toBe("sla_policy_changed");
  });
});

describe("a chart always has its table (RP-11)", () => {
  it("offers the chart and the table as tabs, and shows the same numbers in the table", () => {
    const onViewChange = vi.fn();
    const { rerender, container } = render(
      <ReportVisual
        report={report()}
        view={undefined}
        onViewChange={onViewChange}
      />,
    );
    expect(screen.getByRole("img")).toBeTruthy();
    const tab = screen.getByRole("tab", { name: "reports:views.table" });
    fireEvent.click(tab);
    expect(onViewChange).toHaveBeenCalledWith("table");
    rerender(
      <ReportVisual
        report={report()}
        view="table"
        onViewChange={onViewChange}
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
    const table = screen.getByRole("table", { name: "reports:tableLabel" });
    expect(table.textContent).toContain("urgent");
    expect(table.textContent).toContain("reports:notEnoughData 3/10");
  });

  it("is only a table when the report has no chart", () => {
    render(<ReportVisual report={report({ chart: null })} view={undefined} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});

describe("drill-down (RP-12)", () => {
  it("opens the rows that have a handle, and only those", () => {
    const onDrill = vi.fn();
    render(
      <ReportTable
        columns={report().columns}
        rows={report().rows}
        label="t"
        onDrill={onDrill}
      />,
    );
    const open = screen.getAllByRole("button", { name: "reports:drill.open" });
    expect(open).toHaveLength(1);
    fireEvent.click(open[0] as HTMLElement);
    expect(onDrill).toHaveBeenCalledWith("urgent");
  });

  it("lists the items behind a number", () => {
    items.data = {
      data: [
        {
          key: "RPT-1",
          title: "First",
          projectKey: "P",
          state: "Open",
          priority: "high",
        },
      ],
    };
    render(
      <ReportDrillDialog
        workspaceId="w1"
        reportKey="throughput"
        search={{}}
        handle="2026-10-19"
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("RPT-1")).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();
  });

  it("says when nothing matches", () => {
    items.data = { data: [] };
    render(
      <ReportDrillDialog
        workspaceId="w1"
        reportKey="throughput"
        search={{}}
        handle="x"
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("reports:drill.empty")).toBeTruthy();
  });
});
