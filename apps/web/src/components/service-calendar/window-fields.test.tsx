import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { WindowFields } from "./window-fields";

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key.includes(":") ? key : `${namespace}:${key}`, options),
  }),
}));
afterEach(cleanup);

describe("weekly calendar window", () => {
  it("retains the 1440 day boundary and restores the previous integer-minute end", () => {
    const onChange = vi.fn();
    const props = {
      id: "window-one",
      day: "mon" as const,
      index: 0,
      onChange,
      onRemove: vi.fn(),
    };
    const { container, rerender } = render(
      <WindowFields {...props} window={{ from: 540, to: 1020 }} />,
    );
    const boundary = screen.getByRole("checkbox");
    fireEvent.click(boundary);
    expect(onChange).toHaveBeenLastCalledWith({ to: 1440 });
    rerender(<WindowFields {...props} window={{ from: 540, to: 1440 }} />);
    expect(
      screen.getByLabelText("Monday window 1 end", { exact: true }),
    ).toHaveValue("24:00");
    fireEvent.click(boundary);
    expect(onChange).toHaveBeenLastCalledWith({ to: 1020 });
    expect(container.querySelector('input[type="time"]')).toBeNull();
    const move = screen.getByRole("button", { name: /Move Monday window 1/ });
    expect(move).toHaveAttribute("aria-roledescription", "draggable");
    // WCAG 2.5.3: the visible time range is contained in the name.
    expect(move).toHaveAccessibleName(
      `Move Monday window 1: ${move.textContent}`,
    );
  });

  it("shows times without editing controls for read-only windows", () => {
    render(
      <WindowFields
        id="window-one"
        day="mon"
        index={0}
        window={{ from: 0, to: 1439 }}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByText(/00:00/)).toBeInTheDocument();
    expect(screen.getByText(/23:59/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
