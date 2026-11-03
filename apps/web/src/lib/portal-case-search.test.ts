import { describe, expect, it } from "vitest";
import {
  parsePortalCaseFilterSearch,
  parsePortalHomeSearch,
  parsePortalRequestsSearch,
  routes,
} from "./routes";

function query(href: string) {
  return Object.fromEntries(new URL(href, "https://portal.test").searchParams);
}

describe("S4b portal case search", () => {
  it("round-trips every case filter through the request list URL", () => {
    const href = routes.portalRequests.build({
      scope: "all",
      status: "in_progress,received",
      priority: "urgent,low",
      q: "printer",
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "created_asc",
      project: "ACME",
      cursor: "next_1",
    });
    expect(href).toBe(
      "/requests?scope=all&status=received%2Cin_progress&priority=low%2Curgent&q=printer&from=2026-10-01&to=2026-10-31&sort=created_asc&cursor=next_1&project=ACME",
    );
    expect(parsePortalRequestsSearch(query(href))).toEqual({
      scope: "all",
      status: "received,in_progress",
      priority: "low,urgent",
      q: "printer",
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "created_asc",
      project: "ACME",
      cursor: "next_1",
    });
  });

  it("drops unknown values and keeps the defaults out of the URL", () => {
    expect(
      parsePortalCaseFilterSearch({
        scope: "mine",
        status: "open,received,received",
        priority: "critical",
        q: "   ",
        from: "2026-13-01",
        to: "31/10/2026",
        sort: "updated_desc",
      }),
    ).toEqual({ status: "received" });
    expect(parsePortalCaseFilterSearch({ sort: "title" })).toEqual({});
    expect(parsePortalCaseFilterSearch({ q: "x".repeat(300) }).q).toHaveLength(
      200,
    );
    expect(routes.portalRequests.build({ view: "backlog" })).toBe(
      "/requests?view=backlog",
    );
  });

  it("registers only scope, status and severity on the dashboard", () => {
    const href = routes.portalHome.build({
      scope: "all",
      status: "need_more_info",
      priority: "high",
      project: "ACME",
    });
    expect(href).toBe(
      "/?scope=all&status=need_more_info&priority=high&project=ACME",
    );
    expect(
      parsePortalHomeSearch({
        ...query(href),
        q: "ignored",
        sort: "created_asc",
      }),
    ).toEqual({
      scope: "all",
      status: "need_more_info",
      priority: "high",
      project: "ACME",
    });
    expect(routes.portalHome.build()).toBe("/");
  });
});
