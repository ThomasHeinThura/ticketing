/**
 * Pins the DECLARED policy for `DELETE /api/work-items/{key}/assign`.
 *
 * Why a dedicated test: `matrix.test.ts`'s grid evaluates a route with no row fact, so
 * the `orOwner` branch this entry declares cannot make the grid fail if it were deleted
 * -- the ordinary review of PR #353 proved exactly that shape for `orSelfTarget`
 * (removing the declaration left the whole permissions suite green). This test makes the
 * DECLARATION itself load-bearing, so neither the branch's runtime enforcement
 * (`work-item-unassign.test.ts`'s holder case) nor its declared predicate can drift
 * silently. The predicate string must match the handler's computed fact exactly: the
 * handler decides "the row's CURRENT holder is the caller", and this is where that
 * sentence is spelled in the registry.
 */
import { describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";

describe("policy declaration: DELETE /api/work-items/{key}/assign", () => {
  it("declares work_item:assign with the spec's orOwner(current holder, work_item:update) branch and the exact predicate the handler evaluates", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.entries.find(
      (candidate) =>
        candidate.routeKey === "DELETE /api/work-items/{key}/assign",
    );

    expect(entry).toBeDefined();
    expect(entry?.policy).toMatchObject({
      capability: "work_item:assign",
      scope: "work_item",
      scopeSource: "row",
      reach: "required",
      orOwner: {
        predicate: "row.assignee_id === identity.personId",
        capability: "work_item:update",
      },
    });
  });
});
