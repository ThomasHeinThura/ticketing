import { describe, expect, it } from "vitest";
import {
  checkParent,
  isStale,
  MAX_PAGE_TREE_DEPTH,
  PAGE_RESTORE_WINDOW_DAYS,
  purgeDeadline,
  snippetOf,
  subtreeHeight,
} from "../../apps/api/src/pages/logic";

const chain = (length: number) =>
  Array.from({ length }, (_, i) => ({
    id: `p${i}`,
    parentId: i === 0 ? null : `p${i - 1}`,
  }));

describe("checkParent", () => {
  it("allows a top-level page and a plain nesting", () => {
    expect(checkParent(chain(2), "p1", null)).toBeNull();
    expect(checkParent(chain(2), null, "p1")).toBeNull();
  });

  it("refuses a page as its own parent", () => {
    expect(checkParent(chain(1), "p0", "p0")).toBe("parent_is_self");
  });

  it("refuses moving a page under its own descendant", () => {
    expect(checkParent(chain(3), "p0", "p2")).toBe("parent_cycle");
    expect(checkParent(chain(3), "p0", "p1")).toBe("parent_cycle");
  });

  it("refuses a tree deeper than the limit, counting the moved subtree", () => {
    const full = chain(MAX_PAGE_TREE_DEPTH);
    expect(checkParent(full, null, `p${MAX_PAGE_TREE_DEPTH - 1}`)).toBe(
      "too_deep",
    );
    expect(checkParent(full, null, `p${MAX_PAGE_TREE_DEPTH - 2}`)).toBeNull();
    // A page with a two-level subtree moved under a depth-7 parent would reach depth 10.
    const pages = [
      ...full.slice(0, 7),
      { id: "x", parentId: null },
      { id: "x1", parentId: "x" },
    ];
    expect(checkParent(pages, "x", "p6")).toBe("too_deep");
  });

  it("does not hang on a loop already in stored data", () => {
    const loop = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(checkParent(loop, null, "a")).toBe("parent_cycle");
  });
});

describe("subtreeHeight", () => {
  it("counts levels including the root", () => {
    expect(subtreeHeight(chain(4), "p0")).toBe(4);
    expect(subtreeHeight(chain(4), "p3")).toBe(1);
  });
});

describe("isStale", () => {
  it("is stale whenever the versions differ", () => {
    expect(isStale(3, 3)).toBe(false);
    expect(isStale(3, 2)).toBe(true);
    expect(isStale(3, 4)).toBe(true);
  });
});

describe("snippetOf and purgeDeadline", () => {
  it("flattens whitespace and truncates with an ellipsis", () => {
    expect(snippetOf("a \n b")).toBe("a b");
    const long = snippetOf("x".repeat(500));
    expect(long.length).toBe(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("opens the restore window for the contract's days", () => {
    const now = new Date("2026-10-24T00:00:00.000Z");
    expect(purgeDeadline(now).getTime() - now.getTime()).toBe(
      PAGE_RESTORE_WINDOW_DAYS * 86_400_000,
    );
  });
});
