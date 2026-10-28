import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarTask } from "./calendar-task-bar";
import MonthGrid from "./month-grid";
import { buildMonthWeeks } from "./month-grid-model";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const CELL = 100;
const ROW = 100;

// jsdom has no layout: give each week row a 700x100 box stacked down the page.
const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect");

beforeEach(() => {
  rectSpy.mockImplementation(function (this: Element) {
    const weeks = Array.from(document.querySelectorAll("[data-calendar-week]"));
    const weekIndex = weeks.indexOf(this);
    if (weekIndex >= 0) return new DOMRect(0, weekIndex * ROW, 7 * CELL, ROW);
    const row = this.closest("[data-calendar-week]");
    const rowIndex = row ? weeks.indexOf(row) : 0;
    return new DOMRect(2 * CELL, rowIndex * ROW + 30, 3 * CELL, 20);
  });
});
afterEach(() => {
  cleanup();
  rectSpy.mockReset();
});

const visibleMonth = new Date(2026, 9, 1);
const weeks = buildMonthWeeks(visibleMonth, 0);
// 2026-10-04 (Sunday) is column 0 of week 1; the bar starts Tuesday 10-06, column 2.
const task: CalendarTask = {
  id: "RM-1",
  title: "Plan rollout",
  number: 1,
  status: "in-progress",
  startDate: "2026-10-06",
  dueDate: "2026-10-08",
  version: 3,
  scheduleStart: new Date(2026, 9, 6),
  scheduleEnd: new Date(2026, 9, 8),
};

function renderGrid(onReschedule?: () => void) {
  return render(
    <MonthGrid
      weeks={weeks}
      tasks={[task]}
      visibleMonth={visibleMonth}
      maxLanes={3}
      onOpenTask={vi.fn()}
      onReschedule={onReschedule}
    />,
  );
}

function dragBar(deltaX: number, deltaY: number) {
  const bar = screen.getByRole("button", { name: /Plan rollout|calendar/ });
  fireEvent.mouseDown(bar, { clientX: 250, clientY: 140, button: 0 });
  // The first move past the activation distance starts the drag; later moves translate it.
  act(() => {
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 250 + 10,
        clientY: 140,
        bubbles: true,
      }),
    );
  });
  act(() => {
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 250 + deltaX,
        clientY: 140 + deltaY,
        bubbles: true,
      }),
    );
  });
  act(() => {
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: 250 + deltaX,
        clientY: 140 + deltaY,
        bubbles: true,
      }),
    );
  });
}

describe("MonthGrid bar drag (VW-26)", () => {
  it("reports the day shift when a bar is dropped three days later", () => {
    const onReschedule = vi.fn();
    renderGrid(onReschedule);
    dragBar(3 * CELL, 0);
    expect(onReschedule).toHaveBeenCalledWith(
      expect.objectContaining({ id: "RM-1" }),
      3,
    );
  });

  it("reports a week per row when dropped on the next row", () => {
    const onReschedule = vi.fn();
    renderGrid(onReschedule);
    dragBar(0, ROW);
    expect(onReschedule).toHaveBeenCalledWith(
      expect.objectContaining({ id: "RM-1" }),
      7,
    );
  });

  it("does not move a bar that was dropped where it started", () => {
    const onReschedule = vi.fn();
    renderGrid(onReschedule);
    dragBar(20, 0);
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("hands screen readers the shared, localised drag instructions", () => {
    renderGrid(vi.fn());
    expect(document.body.textContent).toContain("common:a11y.dnd.instructions");
  });

  it("does not drag at all without a reschedule handler", () => {
    renderGrid(undefined);
    dragBar(3 * CELL, 0);
    // Nothing to assert on a handler: the bar must not carry drag attributes.
    expect(
      screen.getByRole("button", { name: /Plan rollout|calendar/ }),
    ).not.toHaveAttribute("aria-roledescription");
  });
});

describe("MonthGrid week and day ranges (VW-25)", () => {
  it("renders one seven-column row for a week and names the grid from the label", () => {
    const week = [weeks[1]];
    const { container } = render(
      <MonthGrid
        weeks={week}
        tasks={[task]}
        visibleMonth={visibleMonth}
        label="Week of 4 Oct"
        maxLanes={12}
        onOpenTask={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-calendar-week]")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Week of 4 Oct" })).toBeTruthy();
    expect(
      container.querySelector<HTMLElement>("[data-calendar-week]")?.style
        .gridTemplateColumns,
    ).toBe("repeat(7, minmax(0, 1fr))");
    expect(
      screen.getByRole("button", { name: /Plan rollout|calendar/ }),
    ).toBeTruthy();
  });

  it("renders a single column for a day and shows the item that spans it", () => {
    const { container } = render(
      <MonthGrid
        weeks={[[new Date(2026, 9, 7)]]}
        tasks={[task]}
        visibleMonth={new Date(2026, 9, 7)}
        maxLanes={12}
        onOpenTask={vi.fn()}
      />,
    );
    expect(
      container.querySelector<HTMLElement>("[data-calendar-week]")?.style
        .gridTemplateColumns,
    ).toBe("repeat(1, minmax(0, 1fr))");
    expect(
      screen.getByRole("button", { name: /Plan rollout|calendar/ }),
    ).toBeTruthy();
  });

  it("shows no bar on a day outside the item's dates", () => {
    render(
      <MonthGrid
        weeks={[[new Date(2026, 9, 20)]]}
        tasks={[task]}
        visibleMonth={new Date(2026, 9, 20)}
        maxLanes={12}
        onOpenTask={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Plan rollout|calendar/ }),
    ).toBeNull();
  });
});
