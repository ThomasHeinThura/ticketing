import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  parseWorkItemListSearchFromQueryString,
  routes,
  WORK_ITEM_FILTER_URL_MAX_LENGTH,
  type WorkItemListSearch,
} from "./routes";
import {
  isWorkItemSearchSortField,
  parseWorkItemListSearch,
  parseWorkItemQueryState,
} from "./work-item-list-search";

const FILTERS = [
  "priority:high",
  "(priority:high OR assignee:@me) AND due:>=7d",
  'AND(project:"OPS, Platform",OR(type:incident,watcher:contains(@me)))',
  'project:"quote \\" & ampersand % percent + plus #hash"',
  "title:ünïcode 日本語",
];

describe("work list URL state (AGENTS.md rule 4, SV-11)", () => {
  it.each(FILTERS)(
    "round-trips filter %j and its editor mode and columns through build -> parse",
    (filter) => {
      const state: Partial<WorkItemListSearch> = {
        sort: "priority",
        dir: "desc",
        filter,
        filterMode: "text",
        columns: ["key", "priority", "assignee"],
      };
      const url = routes.workItemList.build({ projectKey: "OPS" }, state);
      const [, query] = url.split("?");
      expect(parseWorkItemListSearchFromQueryString(query ?? "")).toEqual({
        layout: "list",
        sort: "priority",
        dir: "desc",
        filter,
        filterMode: "text",
        columns: ["key", "priority", "assignee"],
      });
    },
  );

  it("is idempotent: rebuilding from a parsed URL reproduces it exactly", () => {
    const url = routes.workItemList.build(
      { projectKey: "OPS" },
      { filter: FILTERS[1], filterMode: "visual", columns: ["title", "key"] },
    );
    const [, query] = url.split("?");
    const parsed = parseWorkItemListSearchFromQueryString(query ?? "");
    expect(routes.workItemList.build({ projectKey: "OPS" }, parsed)).toBe(url);
  });

  it("survives the router's own search codec, which JSON-encodes structured values", () => {
    const search: WorkItemListSearch = {
      layout: "list",
      sort: "key",
      dir: "asc",
      filter: FILTERS[1],
      filterMode: "text",
      columns: ["key", "state"],
    };
    const written = defaultStringifySearch(search);
    const read = defaultParseSearch(written);
    expect(parseWorkItemListSearch(read)).toEqual(search);
  });

  it("adds no filter, mode or columns to the URL unless they were chosen", () => {
    const url = routes.workItemList.build({ projectKey: "OPS" });
    expect(url).not.toContain("filter");
    expect(url).not.toContain("columns");
  });

  it("falls back per property for a hand-edited or hostile URL, never throwing", () => {
    expect(
      parseWorkItemListSearch({
        filter: "x".repeat(WORK_ITEM_FILTER_URL_MAX_LENGTH + 1),
        filterMode: "sql",
        columns: ["key", "key"],
      }),
    ).toEqual({ layout: "list", sort: "key", dir: "asc" });
    expect(parseWorkItemListSearch({ filter: "a\u0000b" })).not.toHaveProperty(
      "filter",
    );
    expect(parseWorkItemListSearch({ filter: 42 })).not.toHaveProperty(
      "filter",
    );
    expect(parseWorkItemListSearch({ filter: "" })).not.toHaveProperty(
      "filter",
    );
  });

  it("accepts a filter of exactly the URL bound", () => {
    const filter = "x".repeat(WORK_ITEM_FILTER_URL_MAX_LENGTH);
    expect(parseWorkItemListSearch({ filter })).toMatchObject({ filter });
  });

  it("accepts columns as an array or as the JSON string a shared link carries, and rejects the rest", () => {
    expect(
      parseWorkItemListSearch({ columns: '["title","key"]' }).columns,
    ).toEqual(["title", "key"]);
    expect(parseWorkItemListSearch({ columns: ["state"] }).columns).toEqual([
      "state",
    ]);
    for (const bad of [
      [],
      ["nope"],
      ["key", "key"],
      '{"a":1}',
      "not json",
      ["key", "title", "state", "assignee", "priority", "dueDate", "key"],
      [1],
      "key",
    ]) {
      expect(parseWorkItemListSearch({ columns: bad })).not.toHaveProperty(
        "columns",
      );
    }
  });
});

describe("parseWorkItemQueryState (shared with saved views)", () => {
  it("adds no defaults: a query that stored no sort, direction or columns stays that way", () => {
    expect(parseWorkItemQueryState({})).toEqual({});
    expect(parseWorkItemQueryState({ layout: "list" })).toEqual({});
    expect(parseWorkItemQueryState(null)).toEqual({});
  });

  it("keeps a sort without a direction and a direction without a sort as given", () => {
    expect(parseWorkItemQueryState({ sort: "title" })).toEqual({
      sort: "title",
    });
    expect(parseWorkItemQueryState({ dir: "desc" })).toEqual({ dir: "desc" });
  });

  it("knows which sort fields the search endpoint accepts (position is rank order only)", () => {
    expect(isWorkItemSearchSortField("priority")).toBe(true);
    expect(isWorkItemSearchSortField("position")).toBe(false);
  });
});
