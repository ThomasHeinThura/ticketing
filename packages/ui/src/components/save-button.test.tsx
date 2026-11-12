import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SAVE_FEEDBACK_DELAY_MS,
  SAVE_FEEDBACK_HOLD_MS,
  SaveButton,
} from "./save-button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SaveButton", () => {
  it("does not show stale success on a fresh mount, but can retain a parent completion", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <SaveButton
        pending={false}
        success
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        Save
      </SaveButton>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    rerender(
      <SaveButton
        key="refreshed"
        pending={false}
        success
        retainedSuccess
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        Save
      </SaveButton>,
    );
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SAVE_FEEDBACK_HOLD_MS));
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
        workingLabel="Saving…"
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
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    rerender(view(true, false));
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SAVE_FEEDBACK_DELAY_MS - 1));
    expect(button.querySelector("svg.animate-spin")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(button.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(status).toHaveTextContent("Saving…");
    expect(screen.getByRole("button", { name: "Save changes" })).toBe(button);
    expect(button.querySelector("svg.animate-spin")).toHaveClass(
      "motion-reduce:animate-none",
    );
    rerender(view(false, true));
    expect(screen.getByRole("button", { name: "Saved" })).toBe(button);
    expect(status).toHaveTextContent("Saved");
    expect(button.querySelector(".invisible")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SAVE_FEEDBACK_HOLD_MS));
    expect(screen.getByRole("button", { name: "Save changes" })).toBe(button);
  });

  it("shows success after a fast save without showing a spinner and resets on error", () => {
    vi.useFakeTimers();
    const view = (pending: boolean, success: boolean) => (
      <SaveButton
        pending={pending}
        success={success}
        savedLabel="Saved"
        workingLabel="Saving…"
      >
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
    act(() => vi.advanceTimersByTime(SAVE_FEEDBACK_DELAY_MS));
    rerender(view(false, false));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(document.querySelector("svg.animate-spin")).toBeNull();
  });
  it("clears completion immediately when success is withdrawn without pending", () => {
    vi.useFakeTimers();
    const view = (success: boolean) => (
      <SaveButton
        pending={false}
        success={success}
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        Save
      </SaveButton>
    );
    const { rerender } = render(view(false));
    rerender(view(true));
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
    rerender(view(false));
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans up both timers on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <SaveButton
        pending
        success={false}
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        Save
      </SaveButton>,
    );
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const second = render(
      <SaveButton
        pending={false}
        success={false}
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        Save
      </SaveButton>,
    );
    second.rerender(
      <SaveButton
        pending={false}
        success
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        Save
      </SaveButton>,
    );
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not duplicate an existing success notice", () => {
    const view = (success: boolean) => (
      <SaveButton
        pending={false}
        success={success}
        announceSuccess={false}
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        Save
      </SaveButton>
    );
    const { rerender } = render(view(false));
    rerender(view(true));
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
