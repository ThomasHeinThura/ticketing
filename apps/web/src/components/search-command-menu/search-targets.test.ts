import { describe, expect, it } from "vitest";
import {
  isPaletteResult,
  projectSearchGroups,
  type SearchResultItem,
  searchResultHref,
} from "./search-targets";

describe("knowledge base palette result", () => {
  const article: SearchResultItem = {
    id: "article id/with space",
    title: "VPN reset",
    type: "kb_article",
  };

  it("recognizes articles and uses the registered agent article route", () => {
    expect(isPaletteResult(article)).toBe(true);
    expect(searchResultHref(article)).toBe(
      "/agent/kb/article%20id%2Fwith%20space",
    );
  });
});

describe("shared palette search projection", () => {
  it("keeps API result rank by group and permits a two-character CJK prefix", () => {
    const results: SearchResultItem[] = [
      {
        id: "item-1",
        type: "work_item",
        key: "PERF-1",
        title: "性能測試項目",
      },
      { id: "article-1", type: "kb_article", title: "性能驗證" },
    ];
    const groups = projectSearchGroups("性能", results, [], (key) => key);

    expect(groups.map((group) => group.value)).toEqual([
      "work_item",
      "kb_article",
    ]);
    expect(groups[0]?.items[0]).toMatchObject({
      title: "PERF-1 性能測試項目",
      href: "/agent/work-items/PERF-1",
    });
  });

  it("shows recent results before a query and omits them when search results are active", () => {
    const recent = {
      id: "item-1",
      type: "work_item" as const,
      title: "PERF-1 Recent item",
      href: "/agent/work-items/PERF-1",
    };

    expect(projectSearchGroups("", [], [recent], (key) => key)).toMatchObject([
      { value: "recent", items: [recent] },
    ]);
    expect(projectSearchGroups("P", [], [recent], (key) => key)).toEqual([]);
  });
});
