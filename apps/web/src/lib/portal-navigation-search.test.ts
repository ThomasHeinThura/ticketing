import { describe, expect, it } from "vitest";
import { portalRouteBuilders } from "./portal-route-builders";
import {
  parseInstanceAuditSearch,
  parsePortalApprovalsSearch,
  parsePortalCatalogueSearch,
  parsePortalInboxSearch,
  parsePortalKbSearch,
  parsePortalProjectSearch,
  parsePortalReleasesSearch,
  parsePortalRequestsSearch,
} from "./routes";

describe("portal and audit URL state", () => {
  it("keeps backlog mode in request links without adding it to release links", () => {
    const url = new URL(
      portalRouteBuilders.portalRequests.build({
        view: "backlog",
        cursor: "next_1",
      }),
      "https://portal.invalid",
    );
    expect(
      parsePortalRequestsSearch(Object.fromEntries(url.searchParams)),
    ).toEqual({
      view: "backlog",
      cursor: "next_1",
    });
    expect(portalRouteBuilders.portalRequests.build()).toBe("/requests");
    expect(parsePortalRequestsSearch({ view: "admin" })).toEqual({});
    expect(
      parsePortalReleasesSearch({ view: "backlog", cursor: "next_1" }),
    ).toEqual({
      cursor: "next_1",
    });
  });
  it("round-trips opaque request cursors and approval selection", () => {
    const requests = new URL(
      portalRouteBuilders.portalRequests.build({ cursor: "opaque_older-50" }),
      "https://portal.invalid",
    );
    expect(
      parsePortalRequestsSearch(Object.fromEntries(requests.searchParams)),
    ).toEqual({ cursor: "opaque_older-50" });
    const approvals = new URL(
      portalRouteBuilders.portalApprovals.build({ approval: "approval-1" }),
      "https://portal.invalid",
    );
    expect(
      parsePortalApprovalsSearch(Object.fromEntries(approvals.searchParams)),
    ).toEqual({ approval: "approval-1" });
  });
  it("refuses malformed or oversized cursors without creating destinations", () => {
    for (const cursor of [
      [],
      {},
      "https://another.invalid",
      "a".repeat(2049),
      "a\n",
    ])
      expect(parsePortalRequestsSearch({ cursor })).toEqual({});
    expect(parsePortalApprovalsSearch({ approval: "../admin" })).toEqual({});
  });
  it("keeps a well-formed project scope and drops anything else", () => {
    expect(parsePortalProjectSearch({ project: "ACME-1" })).toEqual({
      project: "ACME-1",
    });
    for (const project of ["", "../x", "a".repeat(65), ["ACME"], 7])
      expect(parsePortalProjectSearch({ project })).toEqual({});
    expect(parsePortalProjectSearch(null)).toEqual({});
  });
  it("registers the project scope on every portal list and its links", () => {
    const query = (href: string) =>
      Object.fromEntries(new URL(href, "https://portal.invalid").searchParams);
    for (const [href, parse] of [
      [
        portalRouteBuilders.portalRequests.build({
          view: "backlog",
          project: "ACME",
        }),
        parsePortalRequestsSearch,
      ],
      [
        portalRouteBuilders.portalApprovals.build({
          approval: "a-1",
          project: "ACME",
        }),
        parsePortalApprovalsSearch,
      ],
      [
        portalRouteBuilders.portalReleases.build({
          cursor: "c_1",
          project: "ACME",
        }),
        parsePortalReleasesSearch,
      ],
      [
        portalRouteBuilders.portalCatalogue.build({
          q: "vpn",
          project: "ACME",
        }),
        parsePortalCatalogueSearch,
      ],
      [
        portalRouteBuilders.portalKb.build({ q: "vpn", project: "ACME" }),
        parsePortalKbSearch,
      ],
      [
        portalRouteBuilders.portalInbox.build({
          filter: "unread",
          project: "ACME",
        }),
        parsePortalInboxSearch,
      ],
      [
        portalRouteBuilders.portalHome.build({ project: "ACME" }),
        parsePortalProjectSearch,
      ],
      [
        portalRouteBuilders.portalAccount.build({ project: "ACME" }),
        parsePortalProjectSearch,
      ],
    ] as const)
      expect(parse(query(href)), href).toMatchObject({ project: "ACME" });
    expect(portalRouteBuilders.portalHome.build()).toBe("/");
    expect(portalRouteBuilders.portalHome.build({ project: "../x" })).toBe("/");
    expect(portalRouteBuilders.portalRequests.build({ project: "ACME" })).toBe(
      "/requests?project=ACME",
    );
    expect(parsePortalRequestsSearch({ project: "a b" })).toEqual({});
  });
  it("restores audit filters and bounds unsupported limits", () => {
    expect(
      parseInstanceAuditSearch({ action: "submission.accepted", limit: "100" }),
    ).toEqual({ action: "submission.accepted", limit: 100 });
    expect(parseInstanceAuditSearch({ action: [], limit: "100000" })).toEqual({
      action: "",
      limit: 50,
    });
  });
});
