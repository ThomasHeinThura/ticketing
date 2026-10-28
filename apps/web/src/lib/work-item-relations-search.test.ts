import { describe, expect, it } from "vitest";
import {
  parseWorkItemDetailSearch,
  parseWorkItemListSearchFromQueryString,
  routes,
} from "./routes";
import { parseWorkItemRelationsSearch } from "./work-item-relations-search";

describe("item-scoped relation URL state", () => {
  const relations = {
    itemKey: "OPS-1",
    collapsed: true,
    picker: true,
    query: "SSO & access",
    type: "blocked_by",
  } as const;
  it("round trips detail and list-pane disclosures, search and inverse selection", () => {
    const detail = routes.workItemDetail.build(
      { key: "OPS-1" },
      { activity: "public", relations },
    );
    expect(
      parseWorkItemDetailSearch(
        Object.fromEntries(
          new URL(detail, "https://example.test").searchParams,
        ),
      ),
    ).toEqual({ activity: "public", relations });
    const list = routes.workItemList.build(
      { projectKey: "OPS" },
      { layout: "table", item: "OPS-1", relations },
    );
    expect(
      parseWorkItemListSearchFromQueryString(list.split("?")[1]),
    ).toMatchObject({ layout: "table", item: "OPS-1", relations });
  });
  it("drops malformed, unscoped and prototype-bearing state", () => {
    const invalid: unknown[] = [
      null,
      [],
      { itemKey: "bad" },
      '{"itemKey":',
      { itemKey: "OPS-1", constructor: true },
    ];
    for (const relations of invalid)
      expect(parseWorkItemRelationsSearch({ relations })).toEqual({});
  });
  it("bounds query and canonical picker labels without changing valid item scoping", () => {
    expect(
      parseWorkItemRelationsSearch({
        relations: {
          itemKey: "OPS-1",
          query: "x".repeat(201),
          type: "invented",
          collapsed: "true",
        },
      }),
    ).toEqual({ relations: { itemKey: "OPS-1" } });
    expect(
      parseWorkItemRelationsSearch({
        relations: { itemKey: "OPS-1", query: "x\n" },
      }),
    ).toEqual({ relations: { itemKey: "OPS-1" } });
  });
});
