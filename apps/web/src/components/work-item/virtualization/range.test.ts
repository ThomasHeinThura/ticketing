import { describe, expect, it } from "vitest";
import { mergeVirtualRange } from "./range";

describe("virtualized item ranges", () => {
  it("keeps the visible window plus a bounded set of active, focused and adjacent items", () => {
    expect(
      mergeVirtualRange([8, 9, 10], 10_000, [500, 499, 501, 10, -1]),
    ).toEqual([8, 9, 10, 499, 500, 501]);
  });

  it("ignores duplicate, fractional, negative and out-of-range pins", () => {
    expect(mergeVirtualRange([0, 1], 4, [1, 2, 2, 2.5, -1, 4])).toEqual([
      0, 1, 2,
    ]);
  });
});
