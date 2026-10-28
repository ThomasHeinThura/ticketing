import { describe, expect, it } from "vitest";
import {
  collides,
  findFreeSpot,
  fits,
  GRID_COLUMNS,
  moveByCells,
  moveByPixels,
  overlaps,
  resize,
} from "./dashboard-layout";

const a = { x: 0, y: 0, w: 6, h: 4 };
const b = { x: 6, y: 0, w: 6, h: 4 };

describe("dashboard grid (RP-15)", () => {
  it("detects overlap by shared cell, not by touching edges", () => {
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(a, { x: 5, y: 3, w: 2, h: 2 })).toBe(true);
    expect(overlaps(a, { x: 0, y: 4, w: 6, h: 1 })).toBe(false);
    expect(collides({ x: 3, y: 1, w: 2, h: 2 }, [b, a])).toBe(true);
  });

  it("keeps a widget inside the 12 columns", () => {
    expect(fits({ x: 6, y: 0, w: 6, h: 1 })).toBe(true);
    expect(fits({ x: 7, y: 0, w: 6, h: 1 })).toBe(false);
    expect(fits({ x: -1, y: 0, w: 2, h: 1 })).toBe(false);
    expect(fits({ x: 0, y: 0, w: GRID_COLUMNS + 1, h: 1 })).toBe(false);
  });

  it("finds the first free place, scanning rows top to bottom", () => {
    expect(findFreeSpot([], { w: 4, h: 2 })).toEqual({
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    });
    expect(findFreeSpot([a], { w: 6, h: 4 })).toEqual({
      x: 6,
      y: 0,
      w: 6,
      h: 4,
    });
    expect(findFreeSpot([a, b], { w: 6, h: 2 })).toEqual({
      x: 0,
      y: 4,
      w: 6,
      h: 2,
    });
    expect(
      findFreeSpot([{ x: 0, y: 0, w: 12, h: 1 }], { w: 12, h: 1 }),
    ).toEqual({
      x: 0,
      y: 1,
      w: 12,
      h: 1,
    });
  });

  it("snaps a drag to whole cells", () => {
    const metrics = { column: 100, row: 100 };
    const moved = moveByPixels(
      { x: 0, y: 0, w: 4, h: 2 },
      [],
      { x: 230, y: 40 },
      metrics,
    );
    expect(moved).toEqual({ ok: true, cell: { x: 2, y: 0, w: 4, h: 2 } });
    expect(moveByPixels(a, [], { x: 20, y: 30 }, metrics)).toEqual({
      ok: false,
      reason: "unchanged",
    });
  });

  it("refuses a move that leaves the grid or lands on another widget", () => {
    const metrics = { column: 100, row: 100 };
    expect(moveByPixels(b, [], { x: 100, y: 0 }, metrics)).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(moveByPixels(a, [b], { x: 600, y: 0 }, metrics)).toEqual({
      ok: false,
      reason: "overlap",
    });
    expect(moveByPixels(a, [], { x: 0, y: -100 }, metrics)).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(moveByCells({ x: 0, y: 0, w: 2, h: 2 }, [], 1, 1)).toEqual({
      ok: true,
      cell: { x: 1, y: 1, w: 2, h: 2 },
    });
  });

  it("resizes within the grid, never below the minimum, never over a neighbour", () => {
    expect(resize({ x: 0, y: 0, w: 4, h: 2 }, [], 1, 1)).toEqual({
      ok: true,
      cell: { x: 0, y: 0, w: 5, h: 3 },
    });
    expect(resize({ x: 0, y: 0, w: 2, h: 1 }, [], -1, 0)).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(resize({ x: 0, y: 0, w: 2, h: 1 }, [], 0, -1)).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(resize({ x: 8, y: 0, w: 4, h: 2 }, [], 1, 0)).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(resize({ x: 0, y: 0, w: 6, h: 2 }, [b], 1, 0)).toEqual({
      ok: false,
      reason: "overlap",
    });
  });
});
