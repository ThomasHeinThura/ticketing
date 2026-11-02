import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DashboardGrid,
  gridItemStyle,
  useWideGrid,
  WIDE_GRID_MIN_WIDTH,
} from "./dashboard-grid";

type Observed = { callback: ResizeObserverCallback; target?: Element };

function Probe() {
  const { wide, measureRef } = useWideGrid();
  return (
    <DashboardGrid wide={wide} measureRef={measureRef} data-testid="grid">
      <div style={gridItemStyle({ x: 0, y: 0, w: 3, h: 1 }, wide)}>
        {wide ? "wide" : "stacked"}
      </div>
    </DashboardGrid>
  );
}

function stubGridWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
  } as DOMRect);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dashboard grid columns (A-21)", () => {
  const observers: Observed[] = [];
  function stubResizeObserver() {
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        entry: Observed;
        constructor(callback: ResizeObserverCallback) {
          this.entry = { callback };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.target = target;
        }
        disconnect() {}
        unobserve() {}
      },
    );
  }

  it("stacks when the grid itself is narrow, as on a tablet with the sidebar open", () => {
    stubResizeObserver();
    stubGridWidth(520);
    render(<Probe />);
    expect(screen.getByText("stacked")).toBeTruthy();
    expect(screen.getByTestId("grid").style.gridTemplateColumns).toBe(
      "minmax(0, 1fr)",
    );
  });

  it("uses 12 columns when the grid is wide, and follows later resizes", () => {
    stubResizeObserver();
    stubGridWidth(1150);
    render(<Probe />);
    expect(screen.getByText("wide")).toBeTruthy();
    const observer = observers.at(-1);
    act(() => {
      observer?.callback(
        [
          {
            contentRect: { width: WIDE_GRID_MIN_WIDTH - 1 },
          } as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    });
    expect(screen.getByText("stacked")).toBeTruthy();
  });
});
