import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDelayedPending } from "../lib/use-delayed-pending";
import { LoadingStatus } from "./loading-status";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Example({ pending }: { pending: boolean }) {
  const visible = useDelayedPending(pending);
  return pending || visible ? (
    <LoadingStatus visible={visible} label="Chargement…">
      <span>shape</span>
    </LoadingStatus>
  ) : (
    <div>Ready</div>
  );
}
it("does not announce a fast request", () => {
  const view = render(<Example pending />);
  act(() => vi.advanceTimersByTime(40));
  view.rerender(<Example pending={false} />);
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("status")).toBeNull();
});
it("announces once only after 150ms and removes the status with content", () => {
  const view = render(<Example pending />);
  act(() => vi.advanceTimersByTime(149));
  expect(screen.queryByRole("status")).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Chargement…");
  view.rerender(<Example pending={false} />);
  act(() => vi.advanceTimersByTime(300));
  expect(screen.queryByRole("status")).toBeNull();
});
