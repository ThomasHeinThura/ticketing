/**
 * Pins the DECLARED policy for `POST /api/work-items/{key}/assign`.
 *
 * Why a dedicated test: `matrix.test.ts`'s grid evaluates a route with no body fact, so
 * the `orSelfTarget` branch it declares cannot make the grid fail if it were deleted --
 * the ordinary review of PR #353 proved exactly that (removing `orSelfTarget` left the
 * whole permissions suite green). `task/policy.ts`'s own comment says an `orSelfTarget`
 * declaration is only honest when the runtime enforces the branch; this test makes the
 * DECLARATION itself load-bearing, so neither the branch's runtime enforcement
 * (`work-item-assign.test.ts`'s member-self case) nor its declaration can drift silently.
 */
import { describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";

describe("policy declaration: POST /api/work-items/{key}/assign", () => {
  it("declares work_item:assign with the spec's orSelfTarget(self, work_item:update) branch and the exact predicate the handler evaluates", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.entries.find(
      (candidate) => candidate.routeKey === "POST /api/work-items/{key}/assign",
    );

    expect(entry).toBeDefined();
    expect(entry?.policy).toMatchObject({
      capability: "work_item:assign",
      scope: "work_item",
      scopeSource: "row",
      reach: "required",
      orSelfTarget: {
        predicate: "body.assigneeId === identity.personId",
        capability: "work_item:update",
      },
    });
  });
});
