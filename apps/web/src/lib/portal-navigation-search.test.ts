import { describe, expect, it } from "vitest";
import {
  parseInstanceAuditSearch,
  parsePortalApprovalsSearch,
  parsePortalRequestsSearch,
  routes,
} from "./routes";

describe("portal and audit URL state", () => {
  it("round-trips opaque request cursors and approval selection", () => {
    const requests = new URL(
      routes.portalRequests.build({ cursor: "opaque_older-50" }),
      "https://portal.invalid",
    );
    expect(
      parsePortalRequestsSearch(Object.fromEntries(requests.searchParams)),
    ).toEqual({ cursor: "opaque_older-50" });
    const approvals = new URL(
      routes.portalApprovals.build({ approval: "approval-1" }),
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
