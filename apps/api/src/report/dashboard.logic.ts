import type { WindowInput } from "./logic";

/**
 * RP-16: what a new user sees before building anything. Six widgets on the 12-column grid:
 * the promise, the flow of work, what is about to go wrong and who is loaded.
 */
export const DEFAULT_DASHBOARD_NAME = "Overview";

export type WidgetLayout = {
  reportKey: string;
  chartType: "bar" | "line" | "table" | "number";
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DEFAULT_WIDGETS: readonly WidgetLayout[] = [
  { reportKey: "sla_attainment", chartType: "number", x: 0, y: 0, w: 4, h: 2 },
  { reportKey: "throughput", chartType: "number", x: 4, y: 0, w: 4, h: 2 },
  { reportKey: "at_risk_now", chartType: "number", x: 8, y: 0, w: 4, h: 2 },
  { reportKey: "throughput", chartType: "bar", x: 0, y: 2, w: 6, h: 4 },
  { reportKey: "ageing", chartType: "bar", x: 6, y: 2, w: 6, h: 4 },
  { reportKey: "workload", chartType: "bar", x: 0, y: 6, w: 12, h: 4 },
];

export function widgetWindowInput(
  filters: Record<string, unknown>,
): WindowInput {
  const read = (key: string) =>
    typeof filters[key] === "string" ? (filters[key] as string) : undefined;
  return { window: read("window"), from: read("from"), to: read("to") };
}

export type Cell = { x: number; y: number; w: number; h: number };

/** Two grid rectangles overlap when they share at least one cell. */
export function overlaps(a: Cell, b: Cell): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** The widgets of a saved layout must not overlap: a drag that would overlap is refused. */
export function layoutProblem(cells: readonly Cell[]): "overlap" | null {
  for (let i = 0; i < cells.length; i += 1)
    for (let j = i + 1; j < cells.length; j += 1)
      if (overlaps(cells[i] as Cell, cells[j] as Cell)) return "overlap";
  return null;
}
