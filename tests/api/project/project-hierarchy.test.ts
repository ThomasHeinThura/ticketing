import { describe, expect, it } from "vitest";
import {
  checkReparent,
  descendantProjectIds,
  MAX_PROJECT_DEPTH,
  projectLevel,
  subtreeHeight,
} from "../../../apps/api/src/project/hierarchy";

/** a -> b -> c -> d is a 4-level chain; x and y are separate roots. */
function chain(): Map<string, string | null> {
  return new Map<string, string | null>([
    ["a", null],
    ["b", "a"],
    ["c", "b"],
    ["d", "c"],
    ["x", null],
    ["y", null],
  ]);
}

describe("project hierarchy (PR-1)", () => {
  it("caps depth at 4 levels", () => {
    expect(MAX_PROJECT_DEPTH).toBe(4);
  });

  it("counts levels from 1 at the root", () => {
    const parents = chain();
    expect(projectLevel(parents, "a")).toBe(1);
    expect(projectLevel(parents, "d")).toBe(4);
  });

  it("measures subtree height including the node itself", () => {
    const parents = chain();
    expect(subtreeHeight(parents, "d")).toBe(1);
    expect(subtreeHeight(parents, "b")).toBe(3);
    expect(subtreeHeight(parents, "a")).toBe(4);
  });

  it("lists every descendant", () => {
    expect(descendantProjectIds(chain(), "a").sort()).toEqual(["b", "c", "d"]);
    expect(descendantProjectIds(chain(), "d")).toEqual([]);
  });

  it("allows a root and a move within the cap", () => {
    const parents = chain();
    expect(checkReparent(parents, "d", null)).toBeNull();
    expect(checkReparent(parents, "x", "c")).toBeNull(); // x becomes level 4
  });

  it("refuses a fifth level", () => {
    // d is level 4, so nothing may go under it.
    expect(checkReparent(chain(), "x", "d")).toBe("depth_exceeded");
  });

  it("counts the moved subtree's height, not only the node", () => {
    const parents = chain();
    // y gets a child so y's subtree is 2 levels; under c (level 3) it would reach level 5.
    parents.set("z", "y");
    expect(checkReparent(parents, "y", "c")).toBe("depth_exceeded");
    // Moving the same 2-level subtree under b (level 2) ends at level 4: allowed.
    expect(checkReparent(parents, "y", "b")).toBeNull();
  });

  it("refuses a cycle and self-parenting", () => {
    expect(checkReparent(chain(), "a", "d")).toBe("parent_is_descendant");
    expect(checkReparent(chain(), "b", "b")).toBe("parent_is_self");
  });

  it("refuses an unknown parent", () => {
    expect(checkReparent(chain(), "x", "nope")).toBe("parent_not_found");
  });

  it("terminates on a stored cycle instead of looping", () => {
    const cyclic = new Map<string, string | null>([
      ["p", "q"],
      ["q", "p"],
    ]);
    expect(projectLevel(cyclic, "p")).toBe(Number.POSITIVE_INFINITY);
    expect(subtreeHeight(cyclic, "p")).toBeGreaterThan(0);
  });
});
