import { describe, expect, it } from "vitest";
import { validateReparent } from "./hierarchy.js";

describe("validateReparent", () => {
  it("rejects a direct self-parent", () => {
    expect(validateReparent("A", "A", ["A"], 0)).toEqual({
      ok: false,
      reason: "self",
    });
  });

  it("rejects a direct 2-node cycle (A's proposed parent is B, but B's parent is already A)", () => {
    // B's own ancestor chain is [B, A] -- A (the item being reparented) appears in it.
    expect(validateReparent("A", "B", ["B", "A"], 0)).toEqual({
      ok: false,
      reason: "cycle",
    });
  });

  it("rejects an indirect multi-hop cycle (A <- B <- C <- D, reparenting A under D)", () => {
    expect(validateReparent("A", "D", ["D", "C", "B", "A"], 0)).toEqual({
      ok: false,
      reason: "cycle",
    });
  });

  it("permits a legitimate re-parent that shares no ancestry with the item", () => {
    expect(validateReparent("A", "X", ["X", "Y", "Z"], 0)).toEqual({
      ok: true,
    });
  });

  it("permits detaching to a root-level parent (chain of length 1, no descendants)", () => {
    expect(validateReparent("A", "Root", ["Root"], 0)).toEqual({ ok: true });
  });

  it("does not false-positive when the item's OWN id merely resembles an ancestor's, never actually appearing in the chain", () => {
    expect(validateReparent("A", "B", ["B", "C", "D"], 0)).toEqual({
      ok: true,
    });
  });

  it("accepts a chain landing exactly at the depth-5 cap", () => {
    // Parent chain length 3 (parent's own depth 3) + item (depth 4) + a 1-deep subtree
    // under the item (depth 5) == exactly 5, the cap itself.
    expect(validateReparent("A", "P", ["P", "G", "R"], 1)).toEqual({
      ok: true,
    });
  });

  it("rejects a chain one level past the depth-5 cap via the ancestor side alone", () => {
    // Parent chain length 4 (depth 4) + item (depth 5) + no subtree == 5, still fine;
    // one more ancestor hop tips it to 6.
    expect(validateReparent("A", "P", ["P", "G", "R", "X"], 0)).toEqual({
      ok: true,
    });
    expect(validateReparent("A", "P", ["P", "G", "R", "X", "Y"], 0)).toEqual({
      ok: false,
      reason: "max_depth",
    });
  });

  it("rejects a chain that only exceeds the cap once the item's OWN subtree is carried along", () => {
    // Parent chain length 3 (depth 3) + item (depth 4) alone would be fine, but the item
    // carries a 2-deep subtree with it, landing its deepest descendant at depth 6.
    expect(validateReparent("A", "P", ["P", "G", "R"], 2)).toEqual({
      ok: false,
      reason: "max_depth",
    });
  });

  it("respects a custom maxDepth override", () => {
    expect(validateReparent("A", "P", ["P"], 0, 2)).toEqual({ ok: true });
    expect(validateReparent("A", "P", ["P", "G"], 0, 2)).toEqual({
      ok: false,
      reason: "max_depth",
    });
  });

  it("self-parent takes precedence over a coincidental depth violation", () => {
    expect(validateReparent("A", "A", ["A", "B", "C", "D", "E"], 3)).toEqual({
      ok: false,
      reason: "self",
    });
  });
});
