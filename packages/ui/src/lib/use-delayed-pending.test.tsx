import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDelayedPending } from "./use-delayed-pending";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDelayedPending", () => {
  it("never shows a fast request", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    act(() => vi.advanceTimersByTime(40));
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(false);
  });

  it("waits 150ms and remains visible for 300ms after showing", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    act(() => vi.advanceTimersByTime(149));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(50));
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("releases a known empty result at 200ms without retaining the placeholder", () => {
    const { result, rerender } = renderHook(
      ({ pending, empty }) => useDelayedPending(pending, { releaseNow: empty }),
      { initialProps: { pending: true, empty: false } },
    );
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe(true);
    rerender({ pending: false, empty: true });
    expect(result.current).toBe(false);
  });

  it("cleans timers on unmount and handles StrictMode effect replay", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { result, unmount } = renderHook(() => useDelayedPending(true), {
      wrapper,
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a retained indicator on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ pending }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    act(() => vi.advanceTimersByTime(150));
    rerender({ pending: false });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps an already-visible placeholder across a new pending period", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useDelayedPending(pending),
      { initialProps: { pending: true } },
    );
    act(() => vi.advanceTimersByTime(150));
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(100));
    rerender({ pending: true });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe(true);
    rerender({ pending: false });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe(false);
  });
});
