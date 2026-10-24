import { describe, expect, it } from "vitest";
import type { KbCategory } from "@/fetchers/kb";
import { flattenCategories } from "./kb-categories";

const category = (
  id: string,
  parentId: string | null,
  position = 0,
): KbCategory => ({
  id,
  workspaceId: "w1",
  name: id,
  parentId,
  position,
  articleCount: 0,
});

describe("flattenCategories", () => {
  it("orders parents before children with their depth", () => {
    const rows = flattenCategories([
      category("child", "parent"),
      category("parent", null),
      category("other", null),
      category("grandchild", "child"),
    ]);
    expect(rows.map((row) => [row.category.id, row.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
      ["grandchild", 2],
      ["other", 0],
    ]);
  });

  it("terminates on a stored cycle and never repeats a category", () => {
    const rows = flattenCategories([category("a", "b"), category("b", "a")]);
    expect(rows).toEqual([]);
  });
});
