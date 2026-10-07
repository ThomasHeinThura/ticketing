import { describe, expect, it } from "vitest";
import { pendingActionLabelKey } from "./pending-action-action-label";

describe("pending action label lookup", () => {
  it("has a localized label for every registered action", () => {
    expect(
      [
        "delete",
        "bulk_delete",
        "purge",
        "mcp_destructive",
        "user_deactivation",
      ].map(pendingActionLabelKey),
    ).not.toContain("pendingActions:dynamic.unknownAction");
  });

  it("does not expose an unrecognized action identifier", () => {
    expect(pendingActionLabelKey("future_unregistered_action")).toBe(
      "pendingActions:dynamic.unknownAction",
    );
  });
});
