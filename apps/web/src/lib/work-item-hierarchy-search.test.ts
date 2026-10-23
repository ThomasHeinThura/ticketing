import { describe, expect, it } from "vitest";
import {
  parseAgentMyWorkSearchFromQueryString,
  parseProjectBacklogSearchFromQueryString,
  parseWorkItemDetailSearch,
  parseWorkItemListSearchFromQueryString,
  routes,
} from "./routes";
import {
  HIERARCHY_URL_MAX_ENTRIES,
  HIERARCHY_URL_MAX_LENGTH,
  parseWorkItemHierarchySearch,
} from "./work-item-hierarchy-search";

const hierarchy = {
  itemKey: "TD-1",
  expanded: ["TD-8", "TD-1"],
  pages: { "TD-8": 3 },
  collapsed: true as const,
};
describe("hierarchy URL state", () => {
  it("round-trips explicit tree mode while omission remains original direct subtasks", () => {
    const state = { ...hierarchy, mode: "tree" as const };
    const url = new URL(
      routes.workItemDetail.build({ key: "TD-1" }, { hierarchy: state }),
      "https://test.invalid",
    );
    expect(
      parseWorkItemDetailSearch(Object.fromEntries(url.searchParams)),
    ).toEqual({ hierarchy: state });
    expect(
      parseWorkItemHierarchySearch({
        hierarchy: { itemKey: "TD-1", mode: "unknown" },
      }),
    ).toEqual({ hierarchy: { itemKey: "TD-1" } });
  });

  it("preserves case and hyphens in real project prefixes across reload", () => {
    const hierarchy = {
      itemKey: "service-team-1",
      expanded: ["service-team-1"],
      pages: { "service-team-1": 2 },
    };
    expect(
      parseWorkItemHierarchySearch({ hierarchy: JSON.stringify(hierarchy) }),
    ).toEqual({ hierarchy });
  });
  it("round-trips detail activity and hierarchy disclosures/pages together", () => {
    const url = new URL(
      routes.workItemDetail.build(
        { key: "TD-1" },
        { activity: "comments", hierarchy },
      ),
      "https://test.invalid",
    );
    expect(
      parseWorkItemDetailSearch(Object.fromEntries(url.searchParams)),
    ).toEqual({ activity: "comments", hierarchy });
  });
  it("round-trips the same state on a filtered side-pane list", () => {
    const url = routes.workItemList.build(
      { projectKey: "TD" },
      {
        layout: "table",
        sort: "priority",
        dir: "desc",
        item: "TD-1",
        hierarchy,
      },
    );
    expect(
      parseWorkItemListSearchFromQueryString(url.split("?")[1] ?? ""),
    ).toEqual({
      layout: "table",
      sort: "priority",
      dir: "desc",
      item: "TD-1",
      hierarchy,
    });
  });
  it("preserves hierarchy state in backlog and My work side-pane URLs", () => {
    const backlog = routes.projectBacklog.build(
      { projectKey: "TD" },
      { item: "TD-1", hierarchy },
    );
    expect(
      parseProjectBacklogSearchFromQueryString(backlog.split("?")[1] ?? ""),
    ).toEqual({ item: "TD-1", hierarchy });
    const mine = routes.agentMyWork.build({
      item: "TD-1",
      hierarchy,
      lens: "watching",
    });
    expect(
      parseAgentMyWorkSearchFromQueryString(mine.split("?")[1] ?? ""),
    ).toEqual({ item: "TD-1", hierarchy, lens: "watching" });
  });
  it("normalizes duplicate disclosures and refuses noncanonical keys and page counts", () => {
    expect(
      parseWorkItemHierarchySearch({
        hierarchy: {
          itemKey: "TD-1",
          expanded: ["TD-1", "TD-1"],
          pages: {
            "TD-1": 2,
            bad: 3,
            "TD-2": Number.POSITIVE_INFINITY,
            "TD-3": -1,
            "TD-4": 1.5,
          },
        },
      }),
    ).toEqual({
      hierarchy: { itemKey: "TD-1", expanded: ["TD-1"], pages: { "TD-1": 2 } },
    });
    for (const value of [
      null,
      [],
      "oops",
      { itemKey: "TD-1\u0000" },
      { itemKey: "https://evil.invalid" },
      { itemKey: "TD-0" },
    ])
      expect(parseWorkItemHierarchySearch({ hierarchy: value })).toEqual({});
  });
  it("drops invalid hierarchy data without discarding the activity selection", () => {
    expect(
      parseWorkItemDetailSearch({ activity: "public", hierarchy: "{broken" }),
    ).toEqual({ activity: "public" });
  });
  it("rejects oversized disclosure/page maps, raw payloads and prototype-shaped inputs", () => {
    const keys = Array.from(
      { length: HIERARCHY_URL_MAX_ENTRIES + 1 },
      (_, i) => `TD-${i + 1}`,
    );
    for (const hierarchy of [
      { itemKey: "TD-1", expanded: keys },
      { itemKey: "TD-1", pages: Object.fromEntries(keys.map((k) => [k, 2])) },
      { itemKey: "TD-1", extra: "x".repeat(HIERARCHY_URL_MAX_LENGTH) },
      Object.assign(Object.create({ inherited: true }), { itemKey: "TD-1" }),
      {
        itemKey: "TD-1",
        pages: Object.assign(Object.create({ "TD-1": 3 }), { "TD-2": 2 }),
      },
      JSON.parse('{"itemKey":"TD-1","pages":{"__proto__":{"polluted":true}}}'),
      JSON.parse('{"itemKey":"TD-1","pages":{"constructor":4}}'),
    ])
      expect(parseWorkItemHierarchySearch({ hierarchy })).toEqual({});
    const cyclic: Record<string, unknown> = { itemKey: "TD-1" };
    cyclic.self = cyclic;
    expect(parseWorkItemHierarchySearch({ hierarchy: cyclic })).toEqual({});
    expect(
      parseWorkItemHierarchySearch({
        hierarchy: " ".repeat(HIERARCHY_URL_MAX_LENGTH + 1),
      }),
    ).toEqual({});
    expect({}).not.toHaveProperty("polluted");
  });
});
