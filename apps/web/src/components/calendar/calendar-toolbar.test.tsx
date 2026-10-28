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
});
