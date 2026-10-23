import { describe, expect, it } from "vitest";
import { isSupportedNotificationResourceEvent } from "../../../apps/api/src/notification/resource-contract";
import {
  planSlaRecipients,
  slaProjection,
} from "../../../apps/api/src/notification/sla-recipients";
import { canReadSubmissionNotification } from "../../../apps/api/src/notification/submission-reach";
import { isWithinReopenWindow } from "../../../apps/api/src/workflow/customer-reopen";

describe("planSlaRecipients (SLA-16, NO-21/NO-22)", () => {
  it("orders assignee, leads, escalation and keeps the most direct role per person", () => {
    expect(
      planSlaRecipients({
        assigneeId: "a",
        leadIds: ["l1", "a", "l2"],
        escalationPersonIds: ["l2", "s1"],
      }),
    ).toEqual([
      { personId: "a", role: "assignee" },
      { personId: "l1", role: "lead" },
      { personId: "l2", role: "lead" },
      { personId: "s1", role: "escalation" },
    ]);
  });

  it("handles an unassigned item with no leads or stakeholders", () => {
    expect(
      planSlaRecipients({
        assigneeId: null,
        leadIds: [],
        escalationPersonIds: [],
      }),
    ).toEqual([]);
  });
});

describe("slaProjection", () => {
  it("never carries SLA policy internals beyond the key, metric and percentage (EV-5)", () => {
    const at = slaProjection("sla.at_risk", "assignee", "OPS-1", {
      metric: "resolution",
      consumedPct: 80.4,
    });
    expect(at.body).toBe(
      "OPS-1 is at risk of breaching its resolution target (80% consumed).",
    );
    expect(slaProjection("sla.breached", "lead", "OPS-1", {}).title).toBe(
      "SLA breached",
    );
    expect(slaProjection("sla.breached", "escalation", "OPS-1", {}).title).toBe(
      "SLA breach escalated to you",
    );
  });
});

describe("submission inbox reach (IQ-12, IQ-15)", () => {
  const submission = { requesterId: "cust", workspaceId: "ws" };
  const customer = { side: "customer", personId: "cust" } as never;
  const otherCustomer = { side: "customer", personId: "other" } as never;

  it("serves a reply or decline to the owning customer only", () => {
    for (const kind of ["submission.replied", "submission.declined"]) {
      expect(
        canReadSubmissionNotification(
          customer,
          { personId: "cust", kind },
          submission,
        ),
      ).toBe(true);
      expect(
        canReadSubmissionNotification(
          otherCustomer,
          { personId: "other", kind },
          submission,
        ),
      ).toBe(false);
    }
  });

  it("never serves a row addressed to someone else, or an unknown kind", () => {
    expect(
      canReadSubmissionNotification(
        customer,
        { personId: "other", kind: "submission.replied" },
        submission,
      ),
    ).toBe(false);
    expect(
      canReadSubmissionNotification(
        customer,
        { personId: "cust", kind: "submission.accepted" },
        submission,
      ),
    ).toBe(false);
  });

  it("is registered in the resource contract", () => {
    expect(
      isSupportedNotificationResourceEvent("submission", "submission.replied"),
    ).toBe(true);
    expect(
      isSupportedNotificationResourceEvent("submission", "submission.declined"),
    ).toBe(true);
    expect(
      isSupportedNotificationResourceEvent("submission", "submission.accepted"),
    ).toBe(false);
  });
});

describe("WF-21 reopen window", () => {
  const resolved = new Date("2026-10-01T00:00:00Z");
  it("allows a reopen inside the window and refuses it after", () => {
    expect(
      isWithinReopenWindow(resolved, new Date("2026-10-15T00:00:00Z"), 14),
    ).toBe(true);
    expect(
      isWithinReopenWindow(resolved, new Date("2026-10-15T00:00:01Z"), 14),
    ).toBe(false);
  });
});
