import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveButton } from "./save-button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SaveButton", () => {
  it("shows a completed save when mounted after its parent refreshes", () => {
    vi.useFakeTimers();
    render(
      <SaveButton pending={false} success savedLabel="Saved">
        Save
      </SaveButton>,
    );
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
  it("delays working, keeps focus and width reservations, then shows success temporarily", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const view = (pending: boolean, success: boolean) => (
      <SaveButton
        pending={pending}
        success={success}
        savedLabel="Saved"
        onClick={click}
      >
        Save changes
      </SaveButton>
    );
    const { rerender } = render(view(false, false));
    const button = screen.getByRole("button", { name: "Save changes" });
    button.focus();
    const reservation = button.querySelector(".invisible");
    expect(reservation).toHaveTextContent("Saved");
    rerender(view(true, false));
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(149));
    expect(button.querySelector("svg.animate-spin")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(button.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBe(button);
    expect(button.querySelector("svg.animate-spin")).toHaveClass(
      "motion-reduce:animate-none",
    );
    rerender(view(false, true));
    expect(screen.getByRole("button", { name: "Saved" })).toBe(button);
    expect(button.querySelector(".invisible")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole("button", { name: "Save changes" })).toBe(button);
  });

  it("shows success after a fast save without showing a spinner and resets on error", () => {
    vi.useFakeTimers();
    const view = (pending: boolean, success: boolean) => (
      <SaveButton pending={pending} success={success} savedLabel="Saved">
        Save
      </SaveButton>
    );
    const { rerender } = render(view(false, false));
    rerender(view(true, false));
    act(() => vi.advanceTimersByTime(50));
    rerender(view(false, true));
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    expect(document.querySelector("svg.animate-spin")).toBeNull();
    rerender(view(true, false));
    act(() => vi.advanceTimersByTime(150));
    rerender(view(false, false));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(document.querySelector("svg.animate-spin")).toBeNull();
  });
});
