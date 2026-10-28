import { describe, expect, it } from "vitest";
import { isValidPositionSortCursorValue } from "../../apps/api/src/work-item/search/sort-cursor";

describe("position sort cursor precision", () => {
  it("keeps numeric(20,10) values as exact strings", () => {
    expect(isValidPositionSortCursorValue("1234567890.1234567890")).toBe(true);
    expect(isValidPositionSortCursorValue("-9999999999.9999999999")).toBe(true);
    expect(isValidPositionSortCursorValue("0.0000000001")).toBe(true);
  });

  it("rejects values outside PostgreSQL numeric(20,10) precision", () => {
    expect(isValidPositionSortCursorValue("10000000000")).toBe(false);
    expect(isValidPositionSortCursorValue("1.00000000001")).toBe(false);
    expect(isValidPositionSortCursorValue("1e-10")).toBe(false);
    expect(isValidPositionSortCursorValue(0.1)).toBe(false);
  });
});
