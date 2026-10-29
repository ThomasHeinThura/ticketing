import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField } from "./date-field";

afterEach(cleanup);

describe("calendar date field", () => {
  it("names its calendar and emits a calendar day without a UTC conversion", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateField label="From" value="2026-10-30" onChange={onChange} />,
    );
    expect(container.querySelector('input[type="date"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "From" }));
    expect(screen.getByRole("dialog", { name: "From" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /October 31/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-10-31");
  });

  it("clears only when the caller provides a clear action", () => {
    const onChange = vi.fn();
    render(
      <DateField
        label="From"
        value="2026-10-30"
        onChange={onChange}
        clearLabel="Clear date"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "From" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("preserves required-date callers without a clear action", () => {
    render(<DateField label="Date" value="2026-10-30" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
  });

  it("shows an empty placeholder without allowing an empty clear", () => {
    render(
      <DateField
        label="To"
        value=""
        onChange={vi.fn()}
        placeholder="Not set"
        clearLabel="Clear date"
      />,
    );
    expect(screen.getByRole("button", { name: "To" })).toHaveTextContent(
      "Not set",
    );
    fireEvent.click(screen.getByRole("button", { name: "To" }));
    expect(screen.getByRole("button", { name: "Clear date" })).toBeDisabled();
  });

  it("returns focus on Escape without changing the value", async () => {
    const onChange = vi.fn();
    render(<DateField label="From" value="2026-10-30" onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "From" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "From" }), {
      key: "Escape",
      code: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });
});
