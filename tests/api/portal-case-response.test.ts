import { describe, expect, it } from "vitest";
import {
  portalCasePageSchema,
  portalCaseSchema,
} from "../../apps/api/src/intake/portal-cases";

const caseRow = {
  ref: "SUP-1",
  source: "direct",
  title: "Help",
  requestTypeName: "Support",
  priority: null,
  customerStatus: "in_progress",
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  project: null,
  createdBy: { name: null, isYou: true },
  isRequester: true,
  raisedBySupport: true,
  customerVisibility: "private",
  sla: null,
};

describe("portal case response", () => {
  it("requires a boolean and strips internal creator details from list and detail shapes", () => {
    expect(
      portalCaseSchema.safeParse({ ...caseRow, raisedBySupport: undefined })
        .success,
    ).toBe(false);
    const input = {
      ...caseRow,
      creatorId: "internal",
      creatorEmail: "staff@example.test",
    };
    const detail = portalCaseSchema.parse(input);
    const page = portalCasePageSchema.parse({
      cases: [input],
      page: { nextCursor: null, hasMore: false },
      meta: { total: 1 },
    });
    expect(detail.raisedBySupport).toBe(true);
    expect(page.cases[0]).toEqual(detail);
    expect(JSON.stringify(page)).not.toContain("staff@example.test");
    expect(JSON.stringify(page)).not.toContain("creatorId");
    expect(
      portalCaseSchema.parse({ ...caseRow, raisedBySupport: false })
        .raisedBySupport,
    ).toBe(false);
  });
});
