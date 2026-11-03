import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReportChartData } from "@/fetchers/report";
import {
  chartLayout,
  FALLBACK_WIDTH,
  formatChartValue,
  legendHeight,
  lineSegments,
  MIN_PLOT_HEIGHT,
  niceMax,
  PLOT_HEIGHT,
  ReportChart,
  textWidth,
  wrapLabel,
} from "./report-chart";

afterEach(cleanup);

describe("chart maths", () => {
  it("picks a readable axis maximum", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(10)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(0.3)).toBe(0.5);
    expect(niceMax(Number.NaN)).toBe(1);
  });

  it("breaks a line at a gap and never draws a gap as zero (RP-1)", () => {
    expect(lineSegments([1, 2, null, 3, null, null, 4, 5])).toEqual([
      [
        { index: 0, value: 1 },
        { index: 1, value: 2 },
      ],
      [{ index: 3, value: 3 }],
      [
        { index: 6, value: 4 },
        { index: 7, value: 5 },
      ],
    ]);
    expect(lineSegments([null, null])).toEqual([]);
  });

  it("formats values by unit", () => {
    expect(formatChartValue(87.5, "percent")).toBe("87.5%");
    expect(formatChartValue(3.5, "hours")).toBe("3.5 h");
    expect(formatChartValue(4, "count")).toBe("4");
  });
});

describe("chart fit (3 Nov)", () => {
  const weeks = Array.from(
    { length: 26 },
    (_, index) =>
      `2026-${String(4 + Math.floor(index / 4)).padStart(2, "0")}-0${(index % 4) + 1}`,
  );
  const ticks = ["0", "5", "10", "15", "20"];

  it("fills a wide container without scrolling, labels upright", () => {
    const layout = chartLayout({
      containerWidth: 900,
      categories: ["Mon", "Tue", "Wed"],
      seriesCount: 2,
      type: "bar",
      tickLabels: ticks,
    });
    expect(layout).toMatchObject({
      width: 900,
      scrolls: false,
      rotate: false,
      every: 1,
    });
    expect(layout.height).toBe(12 + PLOT_HEIGHT + layout.padBottom);
  });

  it("scrolls inside its frame when there are more bars than room, never squeezing them", () => {
    const layout = chartLayout({
      containerWidth: 310,
      categories: weeks,
      seriesCount: 1,
      type: "bar",
      tickLabels: ticks,
    });
    expect(layout.scrolls).toBe(true);
    expect(layout.slot).toBe(20);
    expect(layout.width).toBeGreaterThan(310);
    expect(layout.width).toBe(
      Math.ceil(layout.padLeft + 12 + layout.slot * weeks.length),
    );
  });

  it("gives each series in a bar group room of its own", () => {
    const layout = chartLayout({
      containerWidth: 200,
      categories: weeks,
      seriesCount: 3,
      type: "bar",
      tickLabels: ticks,
    });
    expect(layout.slot).toBe(32);
  });

  it("wraps labels of several words under their bar instead of cutting them", () => {
    const long = "Infrastructure managed services platform";
    const layout = chartLayout({
      containerWidth: 500,
      categories: [long, "Help Desk", "Network", "Finance"],
      seriesCount: 3,
      type: "bar",
      tickLabels: ticks,
    });
    expect(layout.rotate).toBe(false);
    expect(layout.scrolls).toBe(false);
    expect(layout.lines?.[0]?.join(" ")).toBe(long);
    expect(layout.lines?.[1]).toEqual(["Help Desk"]);
    // Three wrapped lines (18 characters fit a 114 px slot): the bottom padding holds them.
    expect(layout.lines?.[0]).toEqual([
      "Infrastructure",
      "managed services",
      "platform",
    ]);
    expect(layout.padBottom).toBe(14 + 2 * 12 + 14);
  });

  it("widens the slot to the longest word and scrolls when a narrow frame cannot wrap", () => {
    const layout = chartLayout({
      containerWidth: 260,
      categories: [
        "Infrastructure managed services platform",
        "Help Desk",
        "Network",
        "Finance",
      ],
      seriesCount: 1,
      type: "bar",
      tickLabels: ticks,
    });
    expect(layout.scrolls).toBe(true);
    expect(layout.slot).toBe(textWidth("Infrastructure") + 6);
    expect(layout.lines?.[0]).toEqual([
      "Infrastructure",
      "managed",
      "services",
      "platform",
    ]);
  });

  it("keeps an over-long word whole on its own line", () => {
    expect(wrapLabel("Supercalifragilistic expialidocious", 6)).toEqual([
      "Supercalifragilistic",
      "expialidocious",
    ]);
    expect(wrapLabel("Help Desk", 20)).toEqual(["Help Desk"]);
  });

  it("turns single-word labels that do not fit their slot, and makes room below and to the left", () => {
    const long = "Infrastructure-managed-services-platform";
    const layout = chartLayout({
      containerWidth: 400,
      categories: [long, "Help-Desk", "Network", "Finance"],
      seriesCount: 1,
      type: "bar",
      tickLabels: ticks,
    });
    expect(layout.rotate).toBe(true);
    // The turned label's drop is its width times cos 45, so the bottom padding holds it.
    expect(layout.padBottom).toBeGreaterThanOrEqual(
      Math.ceil(textWidth(long) * Math.SQRT1_2),
    );
    // The first label's left end stays inside the drawing.
    expect(
      layout.padLeft + layout.slot / 2 - textWidth(long) * Math.SQRT1_2,
    ).toBeGreaterThanOrEqual(0);
  });

  it("turns dense labels and still labels every category", () => {
    const dense = chartLayout({
      containerWidth: 300,
      categories: weeks,
      seriesCount: 1,
      type: "line",
      tickLabels: ticks,
    });
    expect(dense.rotate).toBe(true);
    expect(dense.slot).toBe(16);
    expect(dense.every).toBe(1);
    const roomy = chartLayout({
      containerWidth: 2000,
      categories: weeks,
      seriesCount: 1,
      type: "line",
      tickLabels: ticks,
    });
    expect(roomy.rotate).toBe(false);
    expect(roomy.every).toBe(1);
  });

  it("shrinks the plot to fit a widget's height, labels, hint and legend included", () => {
    const legend = ["Met", "Missed", "Paused for the customer"];
    const free = chartLayout({
      containerWidth: 500,
      categories: weeks,
      seriesCount: 3,
      type: "bar",
      tickLabels: ticks,
      legendLabels: legend,
    });
    expect(free.plotHeight).toBe(PLOT_HEIGHT);
    const fitted = chartLayout({
      containerWidth: 500,
      categories: weeks,
      seriesCount: 3,
      type: "bar",
      tickLabels: ticks,
      legendLabels: legend,
      fitHeight: 280,
    });
    expect(fitted.scrolls).toBe(true);
    // 24 for the hint, 10 for the scrollbar, the one-line legend, the drawing: all within 280.
    expect(
      fitted.height + 24 + 10 + legendHeight(legend, 500),
    ).toBeLessThanOrEqual(280);
    expect(fitted.plotHeight).toBeLessThan(PLOT_HEIGHT);
    // Never smaller than a readable plot: a tiny frame scrolls instead.
    const tiny = chartLayout({
      containerWidth: 500,
      categories: ["a"],
      seriesCount: 1,
      type: "bar",
      tickLabels: ticks,
      fitHeight: 40,
    });
    expect(tiny.plotHeight).toBe(MIN_PLOT_HEIGHT);
  });

  it("estimates a wrapping legend's height, and none for one series", () => {
    expect(legendHeight(["Only"], 300)).toBe(0);
    expect(legendHeight(["Met", "Missed"], 300)).toBe(8 + 16);
    // Each item is 16 + 7 per character: two 23-character items cannot share 300 px.
    expect(
      legendHeight(["Paused for the customer", "Paused for the customer"], 300),
    ).toBe(8 + 16 * 2 + 4);
  });

  it("widens the value axis for long tick labels", () => {
    const layout = chartLayout({
      containerWidth: 600,
      categories: ["a"],
      seriesCount: 1,
      type: "bar",
      tickLabels: ["0 h", "1250.5 h"],
    });
    expect(layout.padLeft).toBe(textWidth("1250.5 h") + 10);
  });

  it("draws at real size and shows a scroll hint and a named frame only when it scrolls", () => {
    // A year of weeks: more bars than the 640 px fallback holds.
    const year = [...weeks, ...weeks];
    const wide: ReportChartData = {
      type: "bar",
      unit: "count",
      categories: year,
      series: [{ key: "x", label: "X", values: year.map(() => 1) }],
    };
    // Without ResizeObserver (jsdom) the chart is drawn at the fallback width.
    const { container, unmount } = render(
      <ReportChart chart={wide} label="Wide" />,
    );
    const svg = container.querySelector('svg[role="img"]');
    expect(Number(svg?.getAttribute("width"))).toBeGreaterThanOrEqual(
      FALLBACK_WIDTH,
    );
    expect(screen.getByTestId("chart-scroll-hint")).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "reports:chartScroll.region" }),
    ).toBeTruthy();
    expect(container.innerHTML).not.toContain("…");
    unmount();
    render(<ReportChart chart={bar} label="Narrow" />);
    expect(screen.queryByTestId("chart-scroll-hint")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });
});

const bar: ReportChartData = {
  type: "bar",
  unit: "count",
  categories: ["Mon", "Tue", "Wed"],
  series: [
    { key: "met", label: "Met", values: [3, 5, null] },
    { key: "missed", label: "Missed", values: [1, 0, 2] },
  ],
};

describe("ReportChart", () => {
  it("is one named image, with a mark and a hover title for every value", () => {
    const { container } = render(
      <ReportChart chart={bar} label="SLA: chart" />,
    );
    expect(screen.getByRole("img", { name: "SLA: chart" })).toBeTruthy();
    // 3 + 3 categories x series, minus the null
    expect(container.querySelectorAll("rect")).toHaveLength(5);
    expect(container.querySelector("title")?.textContent).toBe("Met, Mon: 3");
    expect(screen.getByText("Missed")).toBeTruthy();
  });

  it("draws a line with a gap as two lines", () => {
    const { container } = render(
      <ReportChart
        label="Trend"
        chart={{
          type: "line",
          unit: "percent",
          categories: ["a", "b", "c", "d"],
          series: [{ key: "x", label: "X", values: [10, null, 30, 40] }],
        }}
      />,
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });

  it("uses design tokens only, never a literal colour", () => {
    const { container } = render(<ReportChart chart={bar} label="x" />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|hsl\(/);
    expect(container.querySelector("rect")?.getAttribute("class")).toContain(
      "fill-chart-1",
    );
  });
});
