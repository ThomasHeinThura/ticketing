import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateField } from "./date-field";

afterEach(cleanup);

describe("calendar date field", () => {
  it("uses its scoped locale and connects external validation to the trigger", async () => {
    const instance = createInstance();
    await instance.init({
      lng: "fr-FR",
      resources: { "fr-FR": { translation: {} } },
    });
    render(
      <I18nextProvider i18n={instance}>
        <DateField
          id="review-date"
          label="Review due"
          value="2028-02-29"
          onChange={vi.fn()}
          aria-invalid
          aria-describedby="review-error"
        />
        <p id="review-error">Choose a later review date.</p>
      </I18nextProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Review due" });
    expect(trigger).toHaveTextContent("29 févr. 2028");
    expect(trigger).toHaveAttribute("id", "review-date");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription("Choose a later review date.");
  });

  it("accepts a distant typed calendar date with Enter without submitting the outer form", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <DateField
          label="Holiday"
          value=""
          onChange={onChange}
          dateEntry={{
            label: "Date (YYYY-MM-DD)",
            invalidLabel: "Invalid date",
            saveLabel: "Use date",
          }}
        />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Holiday" }));
    const input = screen.getByRole("textbox", { name: "Date (YYYY-MM-DD)" });
    fireEvent.change(input, { target: { value: "2021-02-29" } });
    expect(screen.getByRole("button", { name: "Use date" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid date");
    fireEvent.change(input, { target: { value: "2021-12-30" } });
    expect(screen.getByRole("button", { name: "Use date" })).toBeEnabled();
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2021-12-30");
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps four-digit early years when selecting another day", () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="0042-07-03" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    fireEvent.click(screen.getByRole("button", { name: /July 4th, 42/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("0042-07-04");
  });
  it("closes an open calendar when editing is disabled", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DateField label="Date" value="2026-10-30" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Date" })).toBeVisible(),
    );
    rerender(
      <DateField
        label="Date"
        value="2026-10-30"
        onChange={onChange}
        disabled
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Date" })).toBeDisabled();
    rerender(<DateField label="Date" value="2026-10-30" onChange={onChange} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
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
