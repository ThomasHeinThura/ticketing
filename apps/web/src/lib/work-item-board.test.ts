import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  classifyWorkItemWriteError,
  comparePosition,
  rankNeighbours,
  sortByRank,
} from "./work-item-board";

describe("comparePosition", () => {
  it("orders numerically, not lexically", () => {
    expect(comparePosition("9", "10")).toBeLessThan(0);
    expect(comparePosition("10", "9")).toBeGreaterThan(0);
    expect(comparePosition("2.5", "2.5000000000")).toBe(0);
  });

  it("keeps ten-digit fractions apart", () => {
    expect(comparePosition("1.0000000001", "1.0000000002")).toBeLessThan(0);
    expect(comparePosition("1.5", "1.25")).toBeGreaterThan(0);
  });

  it("orders negatives before positives and reverses among negatives", () => {
    expect(comparePosition("-1", "0")).toBeLessThan(0);
    expect(comparePosition("-2", "-1")).toBeLessThan(0);
  });
});

describe("sortByRank", () => {
  it("sorts by position and breaks ties by id without mutating the input", () => {
    const input = [
      { id: "b", position: "2" },
      { id: "a", position: "2" },
      { id: "c", position: "1.5" },
    ];
    expect(sortByRank(input).map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(input.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("rankNeighbours", () => {
  const column = ["a", "b", "c", "d"].map((id, index) => ({
    id,
    position: String(index),
  }));

  it("moving down one slot sits between the next two items", () => {
    expect(rankNeighbours(column, "a", 1)).toEqual({
      beforeId: "b",
      afterId: "c",
    });
  });

  it("moving to the end names only the item before it", () => {
    expect(rankNeighbours(column, "a", 3)).toEqual({ beforeId: "d" });
  });

  it("moving to the start names only the item after it", () => {
    expect(rankNeighbours(column, "d", 0)).toEqual({ afterId: "a" });
  });

  it("moving up one slot sits between the previous two items", () => {
    expect(rankNeighbours(column, "c", 1)).toEqual({
      beforeId: "a",
      afterId: "b",
    });
  });

  it("never names the moved item as its own neighbour", () => {
    for (let to = 0; to < column.length; to += 1) {
      const result = rankNeighbours(column, "b", to);
      expect(result?.beforeId).not.toBe("b");
      expect(result?.afterId).not.toBe("b");
    }
  });

  it("is a no-op when the item would not move, or is unknown", () => {
    expect(rankNeighbours(column, "b", 1)).toBeUndefined();
    expect(rankNeighbours(column, "zzz", 0)).toBeUndefined();
    expect(rankNeighbours([{ id: "only", position: "1" }], "only", 0)).toBe(
      undefined,
    );
  });
});

describe("classifyWorkItemWriteError", () => {
  it.each([
    [404, "gone"],
    [409, "conflict"],
    [422, "rejected"],
    [400, "invalid"],
    [403, "forbidden"],
    [500, "unknown"],
  ] as const)("maps HTTP %i to %s", (status, expected) => {
    expect(classifyWorkItemWriteError(new HttpError(status, "x"))).toBe(
      expected,
    );
  });

  it("treats anything that is not an HttpError as unknown", () => {
    expect(classifyWorkItemWriteError(new Error("network"))).toBe("unknown");
    expect(classifyWorkItemWriteError(undefined)).toBe("unknown");
  });
});
