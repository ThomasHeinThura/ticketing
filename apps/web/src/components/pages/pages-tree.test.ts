import { describe, expect, it } from "vitest";
import type { PageSummary } from "@/fetchers/pages";
import { descendantIds, flattenPageTree } from "./pages-tree";

function page(id: string, parentId: string | null, title = id): PageSummary {
  return {
    id,
    projectId: "p",
    parentId,
    title,
    snippet: "",
    version: 1,
    updatedBy: null,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
  };
}

describe("flattenPageTree", () => {
  it("orders depth first with siblings by title", () => {
    const rows = flattenPageTree([
      page("b", null, "Beta"),
      page("a", null, "Alpha"),
      page("a2", "a", "Zed"),
      page("a1", "a", "Able"),
    ]);
    expect(rows.map((row) => [row.page.id, row.depth])).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a2", 1],
      ["b", 0],
    ]);
  });

  it("shows a page whose parent is missing at the top level", () => {
    const rows = flattenPageTree([page("x", "gone")]);
    expect(rows).toEqual([{ page: page("x", "gone"), depth: 0 }]);
  });

  it("does not loop on a stored cycle", () => {
    const rows = flattenPageTree([page("a", "b"), page("b", "a")]);
    expect(rows.length).toBeLessThanOrEqual(2);
  });
});

describe("descendantIds", () => {
  it("includes the root and every level below it", () => {
    const ids = descendantIds(
      [page("a", null), page("b", "a"), page("c", "b"), page("d", null)],
      "a",
    );
    expect([...ids].sort()).toEqual(["a", "b", "c"]);
  });
});
