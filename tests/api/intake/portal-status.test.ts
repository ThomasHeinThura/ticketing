import { describe, expect, it } from "vitest";
import { portalCustomerStatus } from "../../../apps/api/src/intake/portal-status";

const item = (stateGroup: string, resolved = false) => ({
  stateGroup,
  resolvedAt: resolved ? new Date() : null,
});

describe("CP-5 portal customer status", () => {
  it("maps submission states without a work item", () => {
    expect(portalCustomerStatus("new", null)).toBe("received");
    expect(portalCustomerStatus("clarifying", null)).toBe("need_more_info");
    expect(portalCustomerStatus("declined", null)).toBe("declined");
    expect(portalCustomerStatus("withdrawn", null)).toBe("withdrawn");
    expect(portalCustomerStatus("accepted", null)).toBe("in_progress");
  });

  it("derives accepted requests from the work item, never 'in progress' once resolved", () => {
    expect(portalCustomerStatus("accepted", item("started"))).toBe(
      "in_progress",
    );
    expect(portalCustomerStatus("accepted", item("backlog"))).toBe(
      "in_progress",
    );
    expect(portalCustomerStatus("accepted", item("started", true))).toBe(
      "resolved",
    );
    expect(portalCustomerStatus("accepted", item("completed"))).toBe(
      "resolved",
    );
    expect(portalCustomerStatus("accepted", item("cancelled"))).toBe("closed");
    expect(portalCustomerStatus("duplicate", item("completed", true))).toBe(
      "resolved",
    );
  });
});
