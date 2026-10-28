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

  it("binds the MCP approval decision and exact accepted note without changing legacy hashes", () => {
    const base = {
      action: "mcp_destructive" as const,
      route_key: "POST /api/approvals/{id}/decide",
      target_type: "approval_decision",
      target_ids: ["approval-1"],
      workspace_id: "w",
      project_id: "p",
      organisation_id: "o",
      confirmation_required: "click" as const,
    };
    const approve = canonicalPendingActionPayload({
      ...base,
      mcp_decision: { action: "approve", note: "approve context" },
    });
    const reject = canonicalPendingActionPayload({
      ...base,
      mcp_decision: { action: "reject", note: "rejected: policy" },
    });
    const changedNote = canonicalPendingActionPayload({
      ...base,
      mcp_decision: { action: "reject", note: "rejected: other" },
    });
    const substitutedTarget = canonicalPendingActionPayload({
      ...base,
      target_ids: ["approval-2"],
      mcp_decision: { action: "reject", note: "rejected: policy" },
    });

    expect(hashPendingActionPayload(approve)).not.toBe(
      hashPendingActionPayload(reject),
    );
    expect(hashPendingActionPayload(reject)).not.toBe(
      hashPendingActionPayload(changedNote),
    );
    expect(hashPendingActionPayload(reject)).not.toBe(
      hashPendingActionPayload(substitutedTarget),
    );
    expect(approve.mcp_decision).toEqual({
      action: "approve",
      note: "approve context",
    });

    const legacy = canonicalPendingActionPayload({
      action: "delete",
      route_key: "DELETE /api/work-items/{key}",
      target_type: "work_item",
      target_ids: ["B", "A"],
      workspace_id: "w",
      project_id: "p",
      organisation_id: null,
      confirmation_required: "click",
    });
    expect(hashPendingActionPayload(legacy)).toBe(
      "7c43593f37df2f50501c9e850ff4c3eb4600d8a0a64ff0acae243541453de30a",
    );
  });

  it("does not accept MCP decision intent on another action, target or route", () => {
    const valid = {
      action: "mcp_destructive" as const,
      route_key: "POST /api/approvals/{id}/decide",
      target_type: "approval_decision",
      target_ids: ["approval-1"],
      workspace_id: "w",
      project_id: "p",
      organisation_id: null,
      confirmation_required: "click" as const,
      mcp_decision: { action: "approve" as const, note: null },
    };
    expect(() =>
      canonicalPendingActionPayload({ ...valid, target_ids: ["approval-2"] }),
    ).not.toThrow();
    expect(() =>
      canonicalPendingActionPayload({ ...valid, route_key: "POST /api/other" }),
    ).toThrow(/registered pending-action target/);
    expect(() =>
      canonicalPendingActionPayload({ ...valid, target_type: "work_item" }),
    ).toThrow(/registered pending-action target/);
    expect(() =>
      canonicalPendingActionPayload({ ...valid, action: "delete" }),
    ).toThrow(/registered pending-action target/);
  });

  it("rejects malformed or overlong MCP decision intent", () => {
    const base = {
      action: "mcp_destructive" as const,
      route_key: "POST /api/approvals/{id}/decide",
      target_type: "approval_decision",
      target_ids: ["approval-1"],
      workspace_id: "w",
      project_id: "p",
      organisation_id: null,
      confirmation_required: "click" as const,
    };
    expect(() =>
      canonicalPendingActionPayload({
        ...base,
        mcp_decision: { action: "delete", note: null } as never,
      }),
    ).toThrow(/intent is malformed/);
    expect(() =>
      canonicalPendingActionPayload({
        ...base,
        mcp_decision: { action: "reject", note: "x".repeat(4001) },
      }),
    ).toThrow(/intent is malformed/);
  });
});
