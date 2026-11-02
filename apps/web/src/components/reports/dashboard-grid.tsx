import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { GRID_COLUMNS } from "@/lib/dashboard-layout";

/** One grid row is this tall, in pixels; a widget of height `h` is `h` rows and the gaps between. */
export const ROW_HEIGHT = 88;
export const GRID_GAP = 12;

/**
 * The grid itself must be this wide, in pixels, for 12 columns; narrower, the widgets stack in
 * reading order. Measured on the grid, not the viewport: a 768 px tablet with the sidebar open
 * leaves the grid about 520 px, where twelve columns cut every title short.
 */
export const WIDE_GRID_MIN_WIDTH = 768;

function viewportIsWide(): boolean {
  return typeof window === "undefined" || !window.matchMedia
    ? true
    : window.matchMedia(`(min-width: ${WIDE_GRID_MIN_WIDTH}px)`).matches;
}

/**
 * Whether the grid has room for 12 columns. Attach `measureRef` to the grid (`DashboardGrid`
 * does it through its `measureRef` prop); without ResizeObserver it falls back to the viewport.
 */
export function useWideGrid(): {
  wide: boolean;
  measureRef: (element: HTMLElement | null) => void;
} {
  const [wide, setWide] = useState(viewportIsWide);
  const observer = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = (width: number) => setWide(width >= WIDE_GRID_MIN_WIDTH);
    update(element.getBoundingClientRect().width);
    const next = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    next.observe(element);
    observer.current = next;
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver !== "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(`(min-width: ${WIDE_GRID_MIN_WIDTH}px)`);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { wide, measureRef };
}

export function gridItemStyle(
  cell: { x: number; y: number; w: number; h: number },
  wide: boolean,
): CSSProperties {
  return wide
    ? {
        gridColumn: `${cell.x + 1} / span ${cell.w}`,
        gridRow: `${cell.y + 1} / span ${cell.h}`,
      }
    : { height: cell.h * ROW_HEIGHT + (cell.h - 1) * GRID_GAP };
}

export function DashboardGrid({
  wide,
  measureRef,
  children,
  ...props
}: {
  wide: boolean;
  /** From `useWideGrid`: the grid's own width decides between 12 columns and a stack. */
  measureRef?: (element: HTMLElement | null) => void;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div
      {...props}
      ref={measureRef}
      className="grid gap-3"
      style={
        wide
          ? {
              gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
              gridAutoRows: `${ROW_HEIGHT}px`,
            }
          : { gridTemplateColumns: "minmax(0, 1fr)" }
      }
    >
      {children}
    </div>
  );
}

/** Reading order for the stacked layout: top to bottom, then left to right. */
export function readingOrder<T extends { x: number; y: number }>(
  widgets: readonly T[],
): T[] {
  return [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
}
