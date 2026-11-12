import { Button } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CalendarToolbar from "./calendar-toolbar";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const anchor = new Date(2026, 9, 23);

function renderToolbar(view: "month" | "week" | "day", onViewChange = vi.fn()) {
  render(
    <CalendarToolbar
      visibleMonth={new Date(2026, 9, 1)}
      anchor={anchor}
      rangeDays={[new Date(2026, 9, 18), new Date(2026, 9, 24)]}
      view={view}
      onViewChange={onViewChange}
      onPreviousMonth={vi.fn()}
      onNextMonth={vi.fn()}
      onToday={vi.fn()}
    />,
  );
  return onViewChange;
}

describe("CalendarToolbar range (VW-25)", () => {
  it("wraps the phone toolbar and preserves every action", () => {
    const select = vi.fn();
    const changeView = vi.fn();
    const previous = vi.fn();
    const next = vi.fn();
    const today = vi.fn();
    const { container } = render(
      <div style={{ width: 390 }}>
        <CalendarToolbar
          visibleMonth={anchor}
          onViewChange={changeView}
          onPreviousMonth={previous}
          onNextMonth={next}
          onToday={today}
          actions={<Button onClick={select}>Select items</Button>}
        />
      </div>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.parentElement).toHaveClass(
      "w-full",
      "sm:w-auto",
      "flex-wrap",
    );
    expect(heading.parentElement?.nextElementSibling).toHaveClass(
      "w-full",
      "sm:w-auto",
      "flex-wrap",
    );
    expect(container.querySelectorAll("button")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Select items" }));
    for (const mode of ["month", "week", "day"])
      fireEvent.click(
        screen.getByRole("button", { name: `tasks:calendar.view.${mode}` }),
      );
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.previousMonth" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.today" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.nextMonth" }),
    );
    expect(select).toHaveBeenCalledOnce();
    expect(changeView).toHaveBeenCalledTimes(3);
    expect(previous).toHaveBeenCalledOnce();
    expect(today).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
  it("marks the active range pressed and reports a change", () => {
    const onViewChange = renderToolbar("week");
    expect(
      screen.getByRole("button", { name: "tasks:calendar.view.week" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "tasks:calendar.view.month" }),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.view.day" }),
    );
    expect(onViewChange).toHaveBeenCalledWith("day");
  });

  it("names the previous and next controls for the active range", () => {
    renderToolbar("week");
    expect(
      screen.getByRole("button", { name: "tasks:calendar.previousWeek" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "tasks:calendar.nextWeek" }),
    ).toBeTruthy();
    cleanup();
    renderToolbar("day");
    expect(
      screen.getByRole("button", { name: "tasks:calendar.previousDay" }),
    ).toBeTruthy();
    cleanup();
    renderToolbar("month");
    expect(
      screen.getByRole("button", { name: "tasks:calendar.nextMonth" }),
    ).toBeTruthy();
  });

  it("labels a week by its first and last day and a day by its full date", () => {
    renderToolbar("week");
    const week = screen.getByTestId("calendar-month-label").textContent ?? "";
    expect(week).toContain("18");
    expect(week).toContain("24");
    cleanup();
    renderToolbar("day");
    expect(screen.getByTestId("calendar-month-label").textContent).toContain(
      "23",
    );
  });

  it("uses a page heading by default and permits a section heading for an existing page", () => {
    renderToolbar("month");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "tasks:calendar.title",
    );
    cleanup();
    render(
      <CalendarToolbar
        headingLevel={2}
        visibleMonth={anchor}
        onPreviousMonth={vi.fn()}
        onNextMonth={vi.fn()}
        onToday={vi.fn()}
      />,
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "tasks:calendar.title",
    );
  });
});
