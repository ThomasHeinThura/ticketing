import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Calendar } from "./calendar";

afterEach(() => {
  cleanup();
});

describe("Calendar", () => {
  it("renders a grid of days", () => {
    render(<Calendar mode="single" />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked day", () => {
    const onSelect = vi.fn();
    const defaultMonth = new Date(2026, 0, 15);
    const { container } = render(
      <Calendar
        defaultMonth={defaultMonth}
        mode="single"
        onSelect={onSelect}
      />,
    );

    const day = container.querySelector<HTMLButtonElement>(
      '[data-day="2026-01-15"] button',
    );
    expect(day).not.toBeNull();
    fireEvent.click(day as HTMLButtonElement);
    expect(onSelect).toHaveBeenCalled();
  });

  it("defaults to no forced week start (caller decides, e.g. via its own store)", () => {
    // Regression: `Calendar` no longer reads an app-specific preferences store
    // internally (#9 batch 6) — `weekStartsOn` is a plain optional prop, and
    // omitting it falls back to react-day-picker's own default (Sunday). The
    // weekday header row is `aria-hidden`, so it is read via the DOM directly
    // rather than through an accessibility-tree role query.
    const { container } = render(<Calendar mode="single" />);
    const weekdays = container.querySelectorAll("thead th");
    expect(weekdays[0]).toHaveTextContent(/su/i);
  });

  it("honours an explicit weekStartsOn prop", () => {
    const { container } = render(<Calendar mode="single" weekStartsOn={1} />);
    const weekdays = container.querySelectorAll("thead th");
    expect(weekdays[0]).toHaveTextContent(/mo/i);
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Calendar defaultMonth={new Date(2026, 0, 15)} mode="single" />,
    );

    await expectNoA11yViolations(baseElement);
  });
});
