import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectTaskSearchHeader from "./project-task-search-header";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const PLACEHOLDER = "Search tickets...";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ProjectTaskSearchHeader
      value={value}
      onValueChange={setValue}
      placeholder={PLACEHOLDER}
      clearLabel="Clear all"
      activeLabel="Search active"
    />
  );
}

describe("ProjectTaskSearchHeader", () => {
  it("shows the inline field outside md–lg and an icon button only from md to below lg", () => {
    render(<Harness />);
    const field = screen.getByPlaceholderText(PLACEHOLDER);
    expect(field.closest(".md\\:max-lg\\:hidden")).not.toBeNull();
    const trigger = screen.getByRole("button", { name: PLACEHOLDER });
    expect(trigger).toHaveClass("hidden", "size-7", "md:max-lg:inline-flex");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAccessibleDescription();
    expect(
      screen.queryByTestId("project-task-search-active"),
    ).not.toBeInTheDocument();
  });

  it("marks the collapsed button while a query is active", () => {
    render(<Harness initial="urgent" />);
    expect(
      screen.getByRole("button", { name: PLACEHOLDER }),
    ).toHaveAccessibleDescription("Search active");
    expect(screen.getByTestId("project-task-search-active")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("announces an active search when entered and clears the announcement", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: PLACEHOLDER });
    const field = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(field, { target: { value: "urgent" } });
    expect(trigger).toHaveAccessibleDescription("Search active");
    fireEvent.change(field, { target: { value: "   " } });
    expect(trigger).not.toHaveAccessibleDescription();
    expect(
      screen.queryByTestId("project-task-search-active"),
    ).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "" } });
    expect(trigger).not.toHaveAccessibleDescription();
  });

  it("focuses the inline field on Cmd/Ctrl+F when it is shown", () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 200, 28),
    ] as unknown as DOMRectList);
    render(<Harness />);
    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveFocus();
    expect(screen.getByRole("button", { name: PLACEHOLDER })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens the popover field on Cmd/Ctrl+F when the inline field is hidden, and keeps one value", async () => {
    // jsdom gives a display:none field no client rects, as a browser does from md to below lg.
    render(<Harness initial="urgent" />);
    fireEvent.keyDown(window, { key: "F", metaKey: true });
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText(PLACEHOLDER)).toHaveLength(2),
    );
    const popoverField = screen.getAllByPlaceholderText(PLACEHOLDER)[1];
    expect(popoverField).toHaveValue("urgent");
    await waitFor(() => expect(popoverField).toHaveFocus());

    fireEvent.change(popoverField, { target: { value: "blocked" } });
    for (const field of screen.getAllByPlaceholderText(PLACEHOLDER))
      expect(field).toHaveValue("blocked");
  });

  it("opens the popover from the icon button", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: PLACEHOLDER }));
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText(PLACEHOLDER)).toHaveLength(2),
    );
  });

  it("keeps focus in the popover search after clearing", async () => {
    render(<Harness initial="urgent" />);
    fireEvent.click(screen.getByRole("button", { name: PLACEHOLDER }));
    await waitFor(() =>
      expect(screen.getAllByPlaceholderText(PLACEHOLDER)).toHaveLength(2),
    );
    const input = screen.getAllByPlaceholderText(PLACEHOLDER)[1];
    const clear = screen.getAllByRole("button", { name: "Clear all" }).at(-1);
    expect(clear).toBeDefined();
    clear?.focus();
    fireEvent.click(clear as HTMLElement);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
  });
});
