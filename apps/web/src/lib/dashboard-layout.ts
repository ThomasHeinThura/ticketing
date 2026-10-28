/**
 * The dashboard grid (`RP-15`): 12 columns, rows of a fixed height. Pure geometry, so dragging,
 * resizing and adding a widget are tested without a browser. A widget never overlaps another and
 * never leaves the grid: a move that would do either is refused, not "pushed" somewhere else.
 */
export const GRID_COLUMNS = 12;
export const MAX_ROW = 999;
export const MAX_WIDGETS = 20;
export const MIN_SIZE = { w: 2, h: 1 } as const;
export const MAX_HEIGHT = 12;

export type Cell = { x: number; y: number; w: number; h: number };

export function overlaps(a: Cell, b: Cell): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

export function fits(cell: Cell): boolean {
  return (
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.w >= 1 &&
    cell.h >= 1 &&
    cell.w <= GRID_COLUMNS &&
    cell.h <= MAX_HEIGHT &&
    cell.x + cell.w <= GRID_COLUMNS &&
    cell.y <= MAX_ROW
  );
}

export function collides(cell: Cell, others: readonly Cell[]): boolean {
  return others.some((other) => overlaps(cell, other));
}

/** The first free place for a `w` by `h` widget, scanning rows top to bottom. */
export function findFreeSpot(
  others: readonly Cell[],
  size: { w: number; h: number },
): Cell {
  for (let y = 0; y <= MAX_ROW; y += 1)
    for (let x = 0; x + size.w <= GRID_COLUMNS; x += 1) {
      const candidate = { x, y, ...size };
      if (!collides(candidate, others)) return candidate;
    }
  return { x: 0, y: MAX_ROW, ...size };
}

export type Move =
  | { ok: true; cell: Cell }
  | { ok: false; reason: "outside" | "overlap" | "unchanged" };

/** Move by whole cells: the drag delta in pixels, snapped to the grid and kept inside it. */
export function moveByPixels(
  cell: Cell,
  others: readonly Cell[],
  delta: { x: number; y: number },
  metrics: { column: number; row: number },
): Move {
  const dx = Math.round(delta.x / metrics.column);
  const dy = Math.round(delta.y / metrics.row);
  if (dx === 0 && dy === 0) return { ok: false, reason: "unchanged" };
  const moved = { ...cell, x: cell.x + dx, y: cell.y + dy };
  if (!fits(moved)) return { ok: false, reason: "outside" };
  if (collides(moved, others)) return { ok: false, reason: "overlap" };
  return { ok: true, cell: moved };
}

/** Move by cells (the keyboard and the nudge buttons). */
export function moveByCells(
  cell: Cell,
  others: readonly Cell[],
  dx: number,
  dy: number,
): Move {
  return moveByPixels(cell, others, { x: dx, y: dy }, { column: 1, row: 1 });
}

export function resize(
  cell: Cell,
  others: readonly Cell[],
  dw: number,
  dh: number,
): Move {
  const next = { ...cell, w: cell.w + dw, h: cell.h + dh };
  if (next.w < MIN_SIZE.w || next.h < MIN_SIZE.h)
    return { ok: false, reason: "outside" };
  if (!fits(next)) return { ok: false, reason: "outside" };
  if (collides(next, others)) return { ok: false, reason: "overlap" };
  return { ok: true, cell: next };
}
