import { describe, expect, it } from "vitest";
import {
  canonicalPendingActionPayload,
  hashPendingActionPayload,
  requiredConfirmation,
} from "../../apps/api/src/pending-action/payload";

describe("pending-action canonical payload", () => {
  it("sorts target ids and hashes only the PA-4 fields", () => {
    const payload = canonicalPendingActionPayload({
      action: "delete",
      route_key: "DELETE /api/work-items/{key}",
      target_type: "work_item",
      target_ids: ["B", "A"],
      workspace_id: "w",
      project_id: "p",
      organisation_id: null,
      confirmation_required: "click",
    });

    expect(payload.target_ids).toEqual(["A", "B"]);
    expect(hashPendingActionPayload(payload)).toBe(
      "7c43593f37df2f50501c9e850ff4c3eb4600d8a0a64ff0acae243541453de30a",
    );
  });

  it("selects exactly one confirmation from action and target blast radius", () => {
    expect(
      requiredConfirmation({
        action: "delete",
        targetType: "user",
        targetCount: 1,
      }),
    ).toBe("typed_name_step_up");
    expect(
      requiredConfirmation({
        action: "delete",
        targetType: "project",
        targetCount: 1,
      }),
    ).toBe("typed_name_step_up");
    expect(
      requiredConfirmation({
        action: "bulk_delete",
        targetType: "work_item",
        targetCount: 50,
      }),
    ).toBe("typed_count");
    expect(
      requiredConfirmation({
        action: "bulk_delete",
        targetType: "work_item",
        targetCount: 51,
      }),
    ).toBe("typed_count_step_up");
    expect(
      requiredConfirmation({
        action: "delete",
        targetType: "auth.oidc_connection",
        targetCount: 1,
      }),
    ).toBe("typed_name_step_up");
    expect(
      requiredConfirmation({
        action: "mcp_destructive",
        targetType: "approval",
        targetCount: 1,
      }),
    ).toBe("click");
  });

  it("rejects empty target sets and non-JSON payload objects", () => {
    expect(() =>
      canonicalPendingActionPayload({
        action: "delete",
        route_key: "DELETE /api/work-items/{key}",
        target_type: "work_item",
        target_ids: [],
        workspace_id: "w",
        project_id: "p",
        organisation_id: null,
        confirmation_required: "click",
      }),
    ).toThrow(/at least one target/);
    expect(() =>
      hashPendingActionPayload({ invalid: undefined } as never),
    ).toThrow(/undefined/);
  });

  it("rejects duplicate target ids instead of inflating the confirmed target count", () => {
    expect(() =>
      canonicalPendingActionPayload({
        action: "bulk_delete",
        route_key: "DELETE /api/work-items/{key}",
        target_type: "work_item",
        target_ids: ["SUP-1", "SUP-1"],
        workspace_id: "w",
        project_id: "p",
        organisation_id: null,
        confirmation_required: "typed_count",
      }),
    ).toThrow(/duplicate target ids/);
  });
});
