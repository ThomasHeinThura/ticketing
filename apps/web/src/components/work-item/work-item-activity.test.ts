import { describe, expect, it } from "vitest";
import type { WorkItemActivityRow } from "@/fetchers/work-item/get-work-item-activity";
import { translate } from "@/test/en-translation";
import {
  activityChangeDescription,
  filterActivityRows,
  groupConsecutiveActivity,
} from "./work-item-activity";

function row(
  id: string,
  actorId: string | null,
  createdAt: string,
  kind: "activity" | "comment" = "activity",
): WorkItemActivityRow {
  return {
    id,
    workItemId: "wi_1",
    actorId,
    actorType: actorId ? "person" : "system",
    verb: kind === "comment" ? "commented" : "updated",
    field: kind === "comment" ? null : "priority",
    oldValue: null,
    newValue: null,
    payload: null,
    visibility: "internal",
    workflowVersionId: null,
    createdAt,
    kind,
  };
}

describe("groupConsecutiveActivity", () => {
  it("groups adjacent same-actor field changes within five minutes in display order", () => {
    const rows = [
      row("newest", "person-a", "2026-10-08T10:04:00Z"),
      row("older", "person-a", "2026-10-08T10:00:00Z"),
      row("other", "person-b", "2026-10-08T09:59:00Z"),
    ];
    expect(
      groupConsecutiveActivity(rows).map((group) =>
        group.map((entry) => entry.id),
      ),
    ).toEqual([["other"], ["older", "newest"]]);
  });

  it("keeps comments, different actors, and changes beyond five minutes separate", () => {
    const rows = [
      row("newest", "person-a", "2026-10-08T10:06:00Z"),
      row("old", "person-a", "2026-10-08T10:00:00Z"),
      row("comment", "person-a", "2026-10-08T09:59:00Z", "comment"),
      row("before-comment", "person-a", "2026-10-08T09:58:00Z"),
    ];
    expect(
      groupConsecutiveActivity(rows).map((group) =>
        group.map((entry) => entry.id),
      ),
    ).toEqual([["before-comment"], ["comment"], ["old"], ["newest"]]);
  });

  it("does not group consecutive rows when their actor identity is unknown", () => {
    const rows = [
      row("newest-unknown", null, "2026-10-08T10:01:00Z"),
      row("older-unknown", null, "2026-10-08T10:00:00Z"),
    ];
    expect(
      groupConsecutiveActivity(rows).map((group) =>
        group.map((entry) => entry.id),
      ),
    ).toEqual([["older-unknown"], ["newest-unknown"]]);
  });
});

describe("filterActivityRows", () => {
  it("applies the staff view filters and fails closed on unknown visibility", () => {
    const rows = [
      {
        ...row("public-comment", "person-a", "2026-10-08T10:00:00Z", "comment"),
        visibility: "public",
      },
      {
        ...row("internal-change", "person-a", "2026-10-08T09:00:00Z"),
        visibility: "internal",
      },
      {
        ...row("unknown", "person-a", "2026-10-08T08:00:00Z"),
        visibility: "future",
      },
      {
        ...row(
          "unknown-comment",
          "person-a",
          "2026-10-08T07:00:00Z",
          "comment",
        ),
        visibility: "future",
      },
    ];
    expect(
      filterActivityRows(rows, "everything").map((entry) => entry.id),
    ).toEqual([
      "public-comment",
      "internal-change",
      "unknown",
      "unknown-comment",
    ]);
    expect(
      filterActivityRows(rows, "comments").map((entry) => entry.id),
    ).toEqual(["public-comment", "unknown-comment"]);
    expect(filterActivityRows(rows, "public").map((entry) => entry.id)).toEqual(
      ["public-comment"],
    );
  });
});

describe("relation activity descriptions", () => {
  function change(
    oldValue: unknown,
    newValue: unknown,
    field: string | null = "relation",
  ) {
    return { field, verb: "updated", oldValue, newValue };
  }
  it("shows relation creation and removal as readable from/to labels", () => {
    expect(
      activityChangeDescription(
        change(null, { type: "relates", direction: "outgoing" }),
        translate,
      ),
    ).toBe("Relations: — → relates to");
    expect(
      activityChangeDescription(
        change({ type: "blocks", direction: "incoming" }, null),
        translate,
      ),
    ).toBe("Relations: blocked by → —");
  });
  it.each([
    ["relates", "relates to"],
    ["blocks", "blocked by"],
    ["duplicates", "duplicated by"],
    ["precedes", "follows"],
    ["requires", "required by"],
  ])("renders incoming %s using its declared inverse", (type, label) => {
    expect(
      activityChangeDescription(
        change(null, { type, direction: "incoming" }),
        translate,
      ),
    ).toBe(`Relations: — → ${label}`);
  });
  it("ignores endpoint identifiers and redacts unknown relation values instead of spilling JSON", () => {
    expect(
      activityChangeDescription(
        change(null, {
          type: "blocks",
          direction: "outgoing",
          sourceId: "private-uuid",
          targetKey: "SECRET-9",
        }),
        translate,
      ),
    ).toBe("Relations: — → blocks");
    for (const value of [
      { type: "future", direction: "incoming", secret: "SECRET-9" },
      { type: "blocks", direction: "future" },
      "private-uuid",
      ["SECRET-9"],
    ]) {
      const text = activityChangeDescription(change(null, value), translate);
      expect(text).toBe("Relations: — → Unavailable");
      expect(text).not.toMatch(/SECRET|private|\{|\[/);
    }
  });
  it("preserves other field rendering and grouped verb prefixes", () => {
    expect(
      activityChangeDescription(change("low", "high", "priority"), translate),
    ).toBe("priority: low → high");
    expect(
      activityChangeDescription(
        change({ value: 1 }, null, "estimate"),
        translate,
      ),
    ).toBe('estimate: {"value":1} → —');
    expect(
      activityChangeDescription(change(null, "done", null), translate, true),
    ).toBe("updated: — → done");
    expect(
      activityChangeDescription(change(null, "done", null), translate),
    ).toBe("— → done");
  });
});

describe("readable canonical activity summaries", () => {
  it("does not print rich-text documents, label identifiers or implementation verbs into the timeline", () => {
    expect(
      activityChangeDescription(
        {
          field: "description",
          verb: "updated",
          oldValue: null,
          newValue: {
            type: "doc",
            content: [{ type: "text", text: "Visible description" }],
          },
        },
        translate,
      ),
    ).toBe("updated the description");
    expect(
      activityChangeDescription(
        {
          field: "label",
          verb: "updated",
          oldValue: ["opaque-old-id"],
          newValue: ["opaque-new-id"],
        },
        translate,
        true,
      ),
    ).toBe("updated labels");
    expect(
      activityChangeDescription(
        {
          field: null,
          verb: "attachment.added",
          oldValue: null,
          newValue: null,
        },
        translate,
        true,
      ),
    ).toBe("added an attachment");
    expect(
      activityChangeDescription(
        {
          field: null,
          verb: "attachment.deleted",
          oldValue: null,
          newValue: null,
        },
        translate,
        true,
      ),
    ).toBe("removed an attachment");
  });
});
