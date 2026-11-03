import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElementWidth } from "./use-element-width";

function Probe() {
  const { width, measureRef } = useElementWidth();
  return (
    <div ref={measureRef} data-testid="probe">
      {width === null ? "unmeasured" : String(width)}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useElementWidth", () => {
  it("stays unmeasured without ResizeObserver, so the caller picks a fallback", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Probe />);
    expect(screen.getByText("unmeasured")).toBeTruthy();
  });

  it("measures the element and follows later resizes", () => {
    let callback: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(next: ResizeObserverCallback) {
          callback = next;
        }
        observe() {}
        unobserve() {}
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 412,
    } as DOMRect);
    const { unmount } = render(<Probe />);
    expect(screen.getByText("412")).toBeTruthy();
    act(() => {
      callback?.(
        [{ contentRect: { width: 300 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(screen.getByText("300")).toBeTruthy();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
