import type { DependencyEdge } from "@/fetchers/agile";

export type BarBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ArrowPath = {
  id: string;
  type: DependencyEdge["type"];
  d: string;
};

/** Horizontal run-out from a bar's edge before the arrow turns, in px. */
const STUB = 10;

/**
 * `VW-28`: the arrow from a source bar's right edge to a target bar's left edge, as an elbow path
 * (out, across to the target's row, in). Pure, so the geometry is unit tested without a layout.
 * An edge with either end not on the chart (filtered out, outside the project) draws nothing.
 */
export function buildArrowPaths(
  edges: readonly DependencyEdge[],
  bars: ReadonlyMap<string, BarBox>,
): ArrowPath[] {
  const paths: ArrowPath[] = [];
  for (const edge of edges) {
    const from = bars.get(edge.sourceKey);
    const to = bars.get(edge.targetKey);
    if (!from || !to) continue;
    const y1 = (from.top + from.bottom) / 2;
    const y2 = (to.top + to.bottom) / 2;
    const x1 = from.right;
    const x2 = to.left;
    const elbow = Math.max(x1 + STUB, Math.min(x2 - STUB, x1 + STUB));
    // The target starts to the right of the source: a straight elbow. Otherwise route around the
    // target's left edge so the arrowhead still enters from the left.
    const d =
      x2 - x1 >= 2 * STUB
        ? `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`
        : `M ${x1} ${y1} H ${elbow} V ${(y1 + y2) / 2} H ${x2 - STUB} V ${y2} H ${x2}`;
    paths.push({ id: edge.id, type: edge.type, d });
  }
  return paths;
}

/**
 * Inline SVG overlay for the timeline (tokens only: the stroke is the muted foreground colour).
 * `blocks` is solid and `precedes` dashed, so the two read apart without colour. The overlay
 * ignores pointer events: bars stay draggable and clickable underneath.
 */
export function GanttDependencyArrows({
  paths,
  width,
  height,
  label,
}: {
  paths: readonly ArrowPath[];
  width: number;
  height: number;
  label: string;
}) {
  if (paths.length === 0) return null;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="gantt-dependency-arrows"
      className="pointer-events-none absolute top-0 z-20 text-muted-foreground"
      width={width}
      height={height}
    >
      <defs>
        <marker
          id="gantt-arrowhead"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
        </marker>
      </defs>
      {paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          data-dependency-type={path.type}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray={path.type === "precedes" ? "5 3" : undefined}
          markerEnd="url(#gantt-arrowhead)"
        />
      ))}
    </svg>
  );
}
