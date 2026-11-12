import { act, cleanup, render, screen } from "@testing-library/react";
import { lazy, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DelayedSuspense } from "./delayed-suspense";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fixture() {
  let resolve!: (module: { default: () => React.ReactElement }) => void;
  const Component = lazy(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const tree = (
    <StrictMode>
      <DelayedSuspense fallback={<div>Loading</div>}>
        <Component />
      </DelayedSuspense>
    </StrictMode>
  );
  return { tree, resolve: () => resolve({ default: () => <div>Loaded</div> }) };
}

describe("DelayedSuspense", () => {
  it("reserves hidden space for a fast load", async () => {
    const pending = fixture();
    render(pending.tree);
    expect(screen.getByText("Loading")).not.toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(40);
      pending.resolve();
    });
    expect(screen.getByText("Loaded")).toBeVisible();
    expect(screen.queryByText("Loading")).toBeNull();
  });
  it("retains a slow fallback for 300ms after it appears", async () => {
    const pending = fixture();
    render(pending.tree);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByText("Loading")).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(50);
      pending.resolve();
    });
    expect(screen.getByText("Loading")).toBeVisible();
    expect(screen.getByText("Loaded")).not.toBeVisible();
    act(() => vi.advanceTimersByTime(249));
    expect(screen.getByText("Loading")).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Loaded")).toBeVisible();
    expect(screen.queryByText("Loading")).toBeNull();
  });
  it("reveals an alert as soon as the suspended content resolves", async () => {
    let resolve!: (module: { default: () => React.ReactElement }) => void;
    const Component = lazy(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(
      <DelayedSuspense fallback={<div>Loading</div>}>
        <Component />
      </DelayedSuspense>,
    );
    act(() => vi.advanceTimersByTime(150));
    await act(async () => {
      resolve({ default: () => <div role="alert">Failed</div> });
    });
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("reveals a known failure without waiting for the minimum", async () => {
    let resolve!: (module: { default: () => React.ReactElement }) => void;
    const Component = lazy(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <DelayedSuspense fallback={<div>Loading</div>}>
        <Component />
      </DelayedSuspense>,
    );
    act(() => vi.advanceTimersByTime(150));
    view.rerender(
      <DelayedSuspense immediate fallback={<div>Loading</div>}>
        <Component />
      </DelayedSuspense>,
    );
    await act(async () => {
      resolve({ default: () => <div>Not found</div> });
    });
    expect(screen.getByText("Not found")).toBeVisible();
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("cleans up the timer on unmount", () => {
    const pending = fixture();
    const view = render(pending.tree);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
