import { describe, expect, it } from "vitest";
import {
  buildCustomerDigestSummary,
  buildDigestSummary,
  DIGEST_INBOX_URL,
  DIGEST_MAX_LINES,
} from "../../../apps/api/src/notification/digest-summary";

describe("NO-6 digest summary", () => {
  it("is bounded, deterministic and links only to the authenticated inbox", () => {
    const kinds = [
      "work_item.assigned",
      "work_item.commented",
      "work_item.commented",
      "sla.at_risk",
    ];
    const first = buildDigestSummary("daily", kinds);
    expect(buildDigestSummary("daily", [...kinds].reverse())).toEqual(first);
    expect(first.title).toBe("Your daily summary: 4 updates");
    expect(first.body).toBe("New comments: 2\nAssignments: 1\nSLA risks: 1");
    expect(first.url).toBe(DIGEST_INBOX_URL);
  });

  it("never leaks an unmapped internal event key", () => {
    const summary = buildDigestSummary("hourly", ["secret.internal_kind"]);
    expect(summary.body).toBe("Other updates: 1");
    expect(summary.title).toBe("Your hourly summary: 1 update");
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("folds the tail beyond the line cap", () => {
    const known = [
      "work_item.assigned",
      "work_item.unassigned",
      "work_item.commented",
      "work_item.mentioned",
      "work_item.transitioned",
      "work_item.due_soon",
      "work_item.overdue",
      "work_item.unblocked",
      "work_item.escalated",
      "sla.at_risk",
      "sla.breached",
    ];
    const lines = buildDigestSummary("hourly", known).body.split("\n");
    expect(lines).toHaveLength(DIGEST_MAX_LINES + 1);
    expect(lines.at(-1)).toBe("More kinds of update: 1");
  });

  it("builds a bounded customer request summary without internal event names", () => {
    const summary = buildCustomerDigestSummary("hourly", [
      "work_item.commented",
      "work_item.commented",
      "work_item.transitioned",
      "secret.internal_kind",
    ]);
    expect(summary).toEqual({
      title: "Your hourly request summary: 4 updates",
      body: "New comments: 2\nRequest updates: 2",
      url: "/requests",
    });
    expect(JSON.stringify(summary)).not.toContain("secret");
    expect(JSON.stringify(summary)).not.toContain("work_item");
  });

  it("groups semantically equivalent request events before applying runtime terms", () => {
    const summary = buildCustomerDigestSummary(
      "daily",
      ["work_item.transitioned", "secret.internal_kind"],
      { singular: "Case", plural: "Cases" },
    );
    expect(summary.body).toBe("Case updates: 2");
    expect(summary.title).toBe("Your daily case summary: 2 updates");
  });
});
