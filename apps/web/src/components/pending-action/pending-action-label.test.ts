import { describe, expect, it } from "vitest";
import { translate } from "@/test/en-translation";
import {
  PENDING_ACTION_TARGET_QUERY_PREFIXES,
  pendingActionLabelKey,
} from "./pending-action-label";
import { REGISTERED_DELETION_TARGETS } from "./registered-deletion-targets";

/** Every (action, targetType) pair the server's approval contracts can produce. */
const SERVER_KINDS = [
  ...REGISTERED_DELETION_TARGETS.map((targetType) => ({
    action: "delete",
    targetType,
  })),
  { action: "delete", targetType: "saved_view" },
  { action: "delete", targetType: "service_calendar" },
  { action: "delete", targetType: "work_item" },
  { action: "delete", targetType: "comment" },
  { action: "delete", targetType: "attachment" },
  { action: "delete", targetType: "relation" },
  { action: "bulk_delete", targetType: "work_item" },
  { action: "purge", targetType: "organisation" },
  { action: "purge", targetType: "project" },
  { action: "purge", targetType: "work_item" },
  { action: "mcp_destructive", targetType: "approval_decision" },
  { action: "mcp_destructive", targetType: "import_chunk" },
  { action: "mcp_destructive", targetType: "import_run" },
];

describe("pending action labels", () => {
  it.each(SERVER_KINDS)(
    "names $action $targetType with a real translated label",
    (kind) => {
      const label = translate(pendingActionLabelKey(kind));
      expect(label).not.toBe(kind.action);
      // Raw API words are snake_case (saved_view, mcp_destructive); labels never are.
      expect(label).not.toContain("_");
      expect(label).not.toMatch(/^[a-z]+:[\w.]+$/u);
      expect(label).not.toBe(translate("pendingActions:dynamic.pendingAction"));
    },
  );

  it("titles a saved-view deletion as a translated action, not the raw word delete", () => {
    expect(
      translate(
        pendingActionLabelKey({ action: "delete", targetType: "saved_view" }),
      ),
    ).toBe("Delete saved view");
  });

  it("falls back to the translated generic label for an unknown kind", () => {
    expect(
      pendingActionLabelKey({ action: "archive", targetType: "gizmo" }),
    ).toBe("pendingActions:dynamic.pendingAction");
  });

  it("marks the saved-view list, detail and counts stale after an executed deletion", () => {
    expect(PENDING_ACTION_TARGET_QUERY_PREFIXES.saved_view).toEqual([
      "saved-views",
      "saved-view",
      "saved-view-count",
    ]);
  });
});
