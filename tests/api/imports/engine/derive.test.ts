import { describe, expect, it } from "vitest";
import {
  deriveChunkId,
  deriveIdempotencyKey,
  detectParentCycles,
} from "../../../../apps/api/src/imports/engine/derive";

describe("idempotency key derivation", () => {
  const base = { runId: "run-1", scope: "chunk", ordinal: 3, cursor: "150" };
  it("is deterministic, header-safe and sensitive to every input", () => {
    const key = deriveIdempotencyKey(base);
    expect(key).toBe(deriveIdempotencyKey({ ...base }));
    expect(key).toMatch(/^[a-f0-9]{64}$/u);
    for (const changed of [
      { ...base, runId: "run-2" },
      { ...base, scope: "link" },
      { ...base, ordinal: 4 },
      { ...base, cursor: null },
    ])
      expect(deriveIdempotencyKey(changed)).not.toBe(key);
  });

  it("derives a stable chunk id per page start", () => {
    expect(deriveChunkId("r", "50")).toBe(deriveChunkId("r", "50"));
    expect(deriveChunkId("r", "50")).not.toBe(deriveChunkId("r", null));
    expect(deriveChunkId("r", "50")).not.toBe(deriveChunkId("s", "50"));
    expect(deriveChunkId("r", "50").length).toBeLessThanOrEqual(128);
    // A re-execution under a different approved digest does not collide with earlier chunks.
    expect(deriveChunkId("r", "50", "d1")).not.toBe(
      deriveChunkId("r", "50", "d2"),
    );
    expect(deriveChunkId("r", "50", "d1")).toBe(deriveChunkId("r", "50", "d1"));
  });
});

describe("parent cycle detection", () => {
  const edges = (pairs: Array<[string, string]>) => new Map(pairs);
  it("finds nothing in a tree", () => {
    expect(
      detectParentCycles(
        edges([
          ["b", "a"],
          ["c", "a"],
          ["d", "b"],
        ]),
      ),
    ).toEqual([]);
  });
  it("breaks a self reference and a longer cycle deterministically", () => {
    expect(detectParentCycles(edges([["a", "a"]]))).toEqual(["a"]);
    const cycle = edges([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["d", "a"],
    ]);
    expect(detectParentCycles(cycle)).toEqual(["c"]);
    // Insertion order does not change which edge is cut.
    expect(
      detectParentCycles(
        edges([
          ["d", "a"],
          ["c", "a"],
          ["b", "c"],
          ["a", "b"],
        ]),
      ),
    ).toEqual(["c"]);
  });
  it("breaks every independent cycle and leaves the rest attached", () => {
    const result = detectParentCycles(
      edges([
        ["a", "b"],
        ["b", "a"],
        ["x", "y"],
        ["y", "z"],
        ["z", "x"],
        ["m", "a"],
      ]),
    );
    expect(result).toEqual(["b", "z"]);
  });
});
