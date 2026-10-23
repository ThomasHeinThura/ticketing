import { describe, expect, it } from "vitest";
import { parseWorkItemDetailSectionsSearch } from "./work-item-detail-sections-search";

describe("canonical task supporting section URL state", () => {
  it("accepts only bounded item-scoped registered sections and deduplicates", () => {
    const state = { itemKey: "HELP-4", open: ["sla", "approvals", "sla"] };
    expect(
      parseWorkItemDetailSectionsSearch({ sections: JSON.stringify(state) }),
    ).toEqual({ sections: { itemKey: "HELP-4", open: ["sla", "approvals"] } });
    expect(
      parseWorkItemDetailSectionsSearch({
        sections: { itemKey: "HELP-5", open: ["attachments"] },
      }),
    ).toEqual({ sections: { itemKey: "HELP-5", open: ["attachments"] } });
  });
  it.each([
    null,
    "bad",
    "x".repeat(1025),
    {},
    { itemKey: "HELP-4", open: [] },
    { itemKey: "HELP-4", open: ["bad"] },
    { itemKey: "HELP-4", open: ["sla", "sla", "sla", "sla"] },
    { itemKey: "invalid", open: ["sla"] },
  ])("discards malformed, empty or oversized state %#", (sections) => {
    expect(parseWorkItemDetailSectionsSearch({ sections })).toEqual({});
  });
});
