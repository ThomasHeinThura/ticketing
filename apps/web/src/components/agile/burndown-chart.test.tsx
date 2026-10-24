import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Burndown } from "@/fetchers/agile";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));

import { BurndownChart } from "./burndown-chart";

const base: Burndown = {
  unit: "points",
  noScope: false,
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  openingScope: 10,
  points: [
    { date: "2026-10-01", scope: 10, completed: 0, remaining: 10, ideal: 10 },
    { date: "2026-10-02", scope: 13, completed: 3, remaining: 10, ideal: 5 },
    { date: "2026-10-03", scope: 13, completed: 8, remaining: 5, ideal: 0 },
  ],
  unestimated: { count: 0, share: 0 },
  discontinuities: [],
};

afterEach(cleanup);

describe("BurndownChart", () => {
  it("draws the series as inline SVG with a labelled description", () => {
    render(<BurndownChart burndown={base} />);
    const svg = screen.getByTestId("burndown-svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toContain(
      "burndown.chartDescription",
    );
    for (const id of ["burndown-ideal", "burndown-scope", "burndown-remaining"])
      expect(screen.getByTestId(id).getAttribute("d")).toMatch(/^M/);
    expect(screen.queryByTestId("burndown-discontinuity")).toBeNull();
  });

  it("gives the same numbers in an accessible table", () => {
    render(<BurndownChart burndown={base} />);
    const table = screen.getByTestId("burndown-table");
    const rows = within(table).getAllByRole("row");
    // header + one row per day
    expect(rows).toHaveLength(4);
    expect(
      within(rows[3] as HTMLElement).getAllByRole("cell")[3]?.textContent,
    ).toBe("5");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(5);
  });

  it("says there is no scope instead of drawing a flat line", () => {
    render(
      <BurndownChart
        burndown={{ ...base, noScope: true, points: [], openingScope: 0 }}
      />,
    );
    expect(screen.getByTestId("burndown-no-scope")).toBeTruthy();
    expect(screen.queryByTestId("burndown-svg")).toBeNull();
  });

  it("notes an estimate system change in the middle of the cycle", () => {
    render(
      <BurndownChart
        burndown={{
          ...base,
          discontinuities: [
            {
              date: "2026-10-02",
              kind: "system",
              fromSystem: "points",
              toSystem: "time",
            },
          ],
        }}
      />,
    );
    const note = screen.getByTestId("burndown-discontinuity");
    expect(note.textContent).toContain("burndown.discontinuity");
    expect(note.textContent).toContain("systems.points");
    expect(note.textContent).toContain("systems.time");
  });

  it("reports unestimated items rather than counting them as zero", () => {
    render(
      <BurndownChart
        burndown={{ ...base, unestimated: { count: 2, share: 0.4 } }}
      />,
    );
    expect(screen.getByText(/burndown.unestimated/).textContent).toContain(
      '"percent":40',
    );
  });
});
