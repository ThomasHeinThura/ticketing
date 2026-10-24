import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { GRID_COLUMNS } from "@/lib/dashboard-layout";

/** One grid row is this tall, in pixels; a widget of height `h` is `h` rows and the gaps between. */
export const ROW_HEIGHT = 88;
export const GRID_GAP = 12;

/** The 12-column grid is for wide screens; a narrow screen stacks the widgets in reading order. */
export function useWideGrid(): boolean {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" || !window.matchMedia
      ? true
      : window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
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
  children,
  ...props
}: {
  wide: boolean;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div
      {...props}
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
