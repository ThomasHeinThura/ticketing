import { describe, expect, it } from "vitest";
import type { WorkItemActivityRow } from "@/fetchers/work-item/get-work-item-activity";
import {
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
