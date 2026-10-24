import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReportChartData } from "@/fetchers/report";
import {
  formatChartValue,
  lineSegments,
  niceMax,
  ReportChart,
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
