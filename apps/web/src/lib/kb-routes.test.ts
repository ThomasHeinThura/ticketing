import { describe, expect, it } from "vitest";
import {
  parseKbArticleSearch,
  parseKbEditorSearch,
  parseKbListSearch,
  parsePortalKbSearch,
  routes,
} from "./routes";

describe("knowledge base URL state", () => {
  it("keeps only known list filters and drops the default view", () => {
    expect(
      parseKbListSearch({
        view: "articles",
        q: "vpn",
        state: "published",
        category: "c1",
        overdue: "1",
        junk: "x",
      }),
    ).toEqual({ q: "vpn", state: "published", category: "c1", overdue: true });
    expect(parseKbListSearch({ view: "report", state: "bogus" })).toEqual({
      view: "report",
    });
    expect(parseKbListSearch(undefined)).toEqual({});
  });

  it("round-trips list, article and editor URLs", () => {
    const list = routes.kb.build({ view: "categories", q: "a b" });
    expect(list).toBe("/agent/kb?view=categories&q=a+b");
    expect(routes.kb.build()).toBe("/agent/kb");
    expect(
      routes.kbArticle.build({ id: "a/1" }, { tab: "versions", version: 3 }),
    ).toBe("/agent/kb/a%2F1?tab=versions&version=3");
    expect(routes.kbArticle.build({ id: "a1" })).toBe("/agent/kb/a1");
    expect(routes.kbArticleEdit.build({ id: "a1" }, { preview: true })).toBe(
      "/agent/kb/a1/edit?preview=1",
    );
    expect(parseKbArticleSearch({ tab: "feedback", version: "2" })).toEqual({
      tab: "feedback",
      version: 2,
    });
    expect(parseKbArticleSearch({ tab: "nope", version: "0" })).toEqual({});
    expect(parseKbEditorSearch({ preview: "1" })).toEqual({ preview: true });
    expect(parseKbEditorSearch({ preview: "0" })).toEqual({});
  });

  it("serves the portal knowledge base from the host root, never under /portal", () => {
    expect(routes.portalKb.build({ q: "reset", category: "c1" })).toBe(
      "/kb?q=reset&category=c1",
    );
    expect(routes.portalKb.build()).toBe("/kb");
    expect(routes.portalKbArticle.build({ id: "a1" })).toBe("/kb/a1");
    expect(routes.portalKb.path.startsWith("/portal")).toBe(false);
    expect(parsePortalKbSearch({ q: "x".repeat(500) })).toEqual({});
    expect(parsePortalKbSearch({ q: "a\u0000b" })).toEqual({});
  });
});
