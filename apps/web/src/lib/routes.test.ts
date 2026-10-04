import { describe, expect, it } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import {
  buildGeneratedRouteUrl,
  DEFAULT_WORK_ITEM_LIST_SEARCH,
  parseGeneratedRouteUrl,
  parseServiceCalendarListSearchFromQueryString,
  parseSlaPolicyListSearch,
  parseWorkItemListSearch,
  parseWorkItemListSearchFromQueryString,
  routes,
  toggleWorkItemSortDirection,
  WORK_ITEM_SORT_DIRECTIONS,
  WORK_ITEM_SORT_FIELDS,
} from "./routes";
import { parseCalendarEditorSearch } from "./service-calendar-form";

describe("routes.workItemList", () => {
  it("round-trips every sort field and direction through build -> parse", () => {
    for (const sort of WORK_ITEM_SORT_FIELDS) {
      for (const dir of WORK_ITEM_SORT_DIRECTIONS) {
        const url = routes.workItemList.build(
          { projectKey: "PROJ" },
          { sort, dir },
        );
        const [, queryString] = url.split("?");
        const parsed = parseWorkItemListSearchFromQueryString(queryString);
        expect(parsed).toEqual({ layout: "list", sort, dir });
      }
    }
  });

  it("builds the path the screen inventory names, with the project key in it", () => {
    const url = routes.workItemList.build({ projectKey: "PROJ" });
    expect(url.startsWith("/agent/projects/PROJ/work?")).toBe(true);
  });

  it("encodes a project key that needs escaping", () => {
    const url = routes.workItemList.build({ projectKey: "a/b c" });
    expect(url.startsWith("/agent/projects/a%2Fb%20c/work?")).toBe(true);
  });

  it("defaults to layout=list, sort=key, dir=asc when no search is given", () => {
    const url = routes.workItemList.build({ projectKey: "PROJ" });
    const [, queryString] = url.split("?");
    expect(parseWorkItemListSearchFromQueryString(queryString)).toEqual(
      DEFAULT_WORK_ITEM_LIST_SEARCH,
    );
  });

  it("survives a reload: parsing the exact query string build() produced is idempotent", () => {
    const url = routes.workItemList.build(
      { projectKey: "PROJ" },
      { sort: "dueDate", dir: "desc" },
    );
    const [, queryString] = url.split("?");
    const firstParse = parseWorkItemListSearchFromQueryString(queryString);
    const rebuilt = routes.workItemList.build(
      { projectKey: "PROJ" },
      firstParse,
    );
    expect(rebuilt).toBe(url);
  });

  describe("parseWorkItemListSearch", () => {
    it("falls back to the default for missing fields", () => {
      expect(parseWorkItemListSearch({})).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
      expect(parseWorkItemListSearch(undefined)).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
    });

    it("never throws on malformed input, and falls back per-field", () => {
      expect(
        parseWorkItemListSearch({
          layout: "board", // not built yet -- falls back to list
          sort: "not-a-real-field",
          dir: "sideways",
        }),
      ).toEqual(DEFAULT_WORK_ITEM_LIST_SEARCH);

      expect(
        parseWorkItemListSearch({ sort: "priority", dir: "desc" }),
      ).toEqual({ layout: "list", sort: "priority", dir: "desc" });

      // Non-object input (e.g. a bare string from a malformed bookmark).
      expect(parseWorkItemListSearch("garbage")).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
      expect(parseWorkItemListSearch(null)).toEqual(
        DEFAULT_WORK_ITEM_LIST_SEARCH,
      );
    });
  });

  describe("toggleWorkItemSortDirection", () => {
    it("flips asc <-> desc", () => {
      expect(toggleWorkItemSortDirection("asc")).toBe("desc");
      expect(toggleWorkItemSortDirection("desc")).toBe("asc");
    });
  });
});

describe("G5 route metadata", () => {
  it("keeps agent and portal routes sourced from their independent generated trees", () => {
    expect(generatedRouteMetadata.agent).toContain(
      "/agent/projects/$projectKey/work",
    );
    expect(generatedRouteMetadata.portal).toEqual(["/"]);
  });

  it("round-trips the portal root URL through its route helper", () => {
    const url = new URL(
      routes.portalHome.build(),
      "https://portal.example.test",
    );
    expect(routes.portalHome.parse(url.pathname)).toBe(
      routes.portalHome.build(),
    );
    expect(routes.portalHome.parse("/unmatched")).toBeUndefined();
  });

  it("builds and parses every generated agent and portal route template", () => {
    for (const surface of ["agent", "portal"] as const) {
      for (const template of generatedRouteMetadata[surface]) {
        const names = [...template.matchAll(/\$([A-Za-z0-9_]+)/gu)].map(
          (match) => match[1],
        );
        const params = Object.fromEntries(
          names.map((name) => [name, `value/${name} part`]),
        );
        const url = buildGeneratedRouteUrl(surface, template, params);
        expect(parseGeneratedRouteUrl(surface, template, url)).toEqual({
          pathname: url,
          params,
        });
      }
    }
  });
});

describe("routes.workItemDetail", () => {
  it("builds the future detail path with the work item key", () => {
    expect(routes.workItemDetail.build({ key: "PROJ-123" })).toBe(
      "/agent/work-items/PROJ-123",
    );
  });

  it("encodes a key that needs escaping", () => {
    expect(routes.workItemDetail.build({ key: "a/b" })).toBe(
      "/agent/work-items/a%2Fb",
    );
  });
});

describe("routes.serviceCalendars", () => {
  it("builds the list route named by the screen inventory", () => {
    expect(routes.serviceCalendars.build()).toBe("/agent/settings/calendars");
  });

  it("round-trips one opaque cursor through URL encoding without page history", () => {
    const search = { cursor: "cursor/a+b?=" };
    const url = routes.serviceCalendars.build(search);
    expect(
      parseServiceCalendarListSearchFromQueryString(url.split("?")[1] ?? ""),
    ).toEqual(search);
    expect(url).not.toContain("history=");
  });

  it("preserves the editor id and preview year in its URL", () => {
    const url = routes.serviceCalendarEditor.build({ id: "cal/one" }, 2026);
    expect(url).toBe("/agent/settings/calendars/cal%2Fone?year=2026");
    expect(
      parseCalendarEditorSearch({
        year: new URL(url, "https://taskdesk.invalid").searchParams.get("year"),
      }),
    ).toEqual({ year: 2026 });
  });

  it("does not add search state when the year is not supplied", () => {
    expect(routes.serviceCalendarEditor.build({ id: "new" })).toBe(
      "/agent/settings/calendars/new",
    );
  });
});

describe("routes.slaPolicies", () => {
  it("round-trips the list cursor and editor id through registered route builders", () => {
    const url = routes.slaPolicies.build({ cursor: "opaque/a+b" });
    expect(url).toBe("/agent/settings/sla-policies?cursor=opaque%2Fa%2Bb");
    expect(
      parseSlaPolicyListSearch({
        cursor: new URL(url, "https://taskdesk.invalid").searchParams.get(
          "cursor",
        ),
      }),
    ).toEqual({ cursor: "opaque/a+b" });
    expect(routes.slaPolicyEditor.build({ id: "policy/one" })).toBe(
      "/agent/settings/sla-policies/policy%2Fone",
    );
  });
});

describe("routes.identityConnections", () => {
  it("keeps the God Mode list and connection editor directly addressable", () => {
    expect(routes.identityConnections.build()).toBe("/god-mode/authentication");
    expect(
      routes.identityConnectionSettings.build({ id: "connection/a" }),
    ).toBe("/god-mode/authentication/connection%2Fa");
    expect(generatedRouteMetadata.agent).toContain(
      routes.identityConnections.path,
    );
    expect(generatedRouteMetadata.agent).toContain(
      routes.identityConnectionSettings.path,
    );
  });
});
