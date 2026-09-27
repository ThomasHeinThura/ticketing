/**
 * Unit tests for the pure half of the issue #8 / #324 per-router shadow-mode coverage
 * report -- see that script's own doc comment for why "evaluated" excludes both
 * `unevaluated` and `evaluator_error`, and why this script reports coverage but does not
 * decide "clean" (that also needs a human-explained reason code per `runbook.md`).
 */
import { describe, expect, it } from "vitest";
import {
  perRouterCoverage,
  type ShadowTallyBucket,
} from "../../../apps/api/scripts/policy-shadow-coverage-report";

function bucket(overrides: Partial<ShadowTallyBucket> = {}): ShadowTallyBucket {
  return {
    routerGroup: "work-item",
    outcome: "agree",
    reasonCode: null,
    count: 1,
    ...overrides,
  };
}

describe("perRouterCoverage", () => {
  it("returns an empty report for no rows", () => {
    expect(perRouterCoverage([])).toEqual([]);
  });

  it("counts agree as evaluated, at 100% for a single clean router", () => {
    const [result] = perRouterCoverage([
      bucket({ routerGroup: "workspace", outcome: "agree", count: 42 }),
    ]);
    expect(result).toEqual({
      routerGroup: "workspace",
      totalRequests: 42,
      evaluatedRequests: 42,
      evaluatedPercent: 100,
      unevaluatedRequests: 0,
      evaluatorErrorRequests: 0,
      disagreementRequests: 0,
      hasSaturationDrops: false,
    });
  });

  it("counts both disagreement outcomes as evaluated AND as disagreements", () => {
    const result = perRouterCoverage([
      bucket({
        routerGroup: "project",
        outcome: "legacy_allow_policy_deny",
        count: 3,
      }),
      bucket({
        routerGroup: "project",
        outcome: "legacy_deny_policy_allow",
        count: 5,
      }),
    ]);
    expect(result).toEqual([
      {
        routerGroup: "project",
        totalRequests: 8,
        evaluatedRequests: 8,
        evaluatedPercent: 100,
        unevaluatedRequests: 0,
        evaluatorErrorRequests: 0,
        disagreementRequests: 8,
        hasSaturationDrops: false,
      },
    ]);
  });

  it("counts unevaluated as NOT evaluated, dragging the percentage down", () => {
    const [result] = perRouterCoverage([
      bucket({ routerGroup: "work-item", outcome: "agree", count: 3 }),
      bucket({
        routerGroup: "work-item",
        outcome: "unevaluated",
        reasonCode: "row_scope_unavailable",
        count: 1,
      }),
    ]);
    expect(result?.totalRequests).toBe(4);
    expect(result?.evaluatedRequests).toBe(3);
    expect(result?.evaluatedPercent).toBe(75);
    expect(result?.unevaluatedRequests).toBe(1);
  });

  it("counts evaluator_error as NOT evaluated and separately from unevaluated", () => {
    const [result] = perRouterCoverage([
      bucket({ routerGroup: "asset", outcome: "agree", count: 9 }),
      bucket({
        routerGroup: "asset",
        outcome: "evaluator_error",
        reasonCode: "evaluator_threw",
        count: 1,
      }),
    ]);
    expect(result).toEqual({
      routerGroup: "asset",
      totalRequests: 10,
      evaluatedRequests: 9,
      evaluatedPercent: 90,
      unevaluatedRequests: 0,
      evaluatorErrorRequests: 1,
      disagreementRequests: 0,
      hasSaturationDrops: false,
    });
  });

  it("flags hasSaturationDrops only for unevaluated rows reason-coded shadow_saturated", () => {
    const [result] = perRouterCoverage([
      bucket({
        routerGroup: "label",
        outcome: "unevaluated",
        reasonCode: "shadow_saturated",
        count: 2,
      }),
    ]);
    expect(result?.hasSaturationDrops).toBe(true);

    const [otherReason] = perRouterCoverage([
      bucket({
        routerGroup: "label",
        outcome: "unevaluated",
        reasonCode: "row_scope_unavailable",
        count: 2,
      }),
    ]);
    expect(otherReason?.hasSaturationDrops).toBe(false);
  });

  it("sums multiple day/route_key/reason_code buckets onto one router group", () => {
    const result = perRouterCoverage([
      bucket({ routerGroup: "work-item", outcome: "agree", count: 10 }),
      bucket({ routerGroup: "work-item", outcome: "agree", count: 5 }),
      bucket({
        routerGroup: "work-item",
        outcome: "unevaluated",
        reasonCode: "reach_unavailable",
        count: 2,
      }),
      bucket({
        routerGroup: "work-item",
        outcome: "unevaluated",
        reasonCode: "missing_identity",
        count: 3,
      }),
    ]);
    expect(result).toEqual([
      {
        routerGroup: "work-item",
        totalRequests: 20,
        evaluatedRequests: 15,
        evaluatedPercent: 75,
        unevaluatedRequests: 5,
        evaluatorErrorRequests: 0,
        disagreementRequests: 0,
        hasSaturationDrops: false,
      },
    ]);
  });

  it("keeps router groups fully independent and orders the report by group name", () => {
    const result = perRouterCoverage([
      bucket({ routerGroup: "workspace", outcome: "agree", count: 1 }),
      bucket({
        routerGroup: "asset",
        outcome: "unevaluated",
        reasonCode: "row_scope_unavailable",
        count: 1,
      }),
      bucket({ routerGroup: "project", outcome: "agree", count: 1 }),
    ]);
    expect(result.map((r) => r.routerGroup)).toEqual([
      "asset",
      "project",
      "workspace",
    ]);
    expect(result.find((r) => r.routerGroup === "asset")).toMatchObject({
      evaluatedPercent: 0,
    });
  });

  it("rounds the percentage to 2 decimals rather than truncating", () => {
    const [result] = perRouterCoverage([
      bucket({ routerGroup: "comment", outcome: "agree", count: 1 }),
      bucket({
        routerGroup: "comment",
        outcome: "unevaluated",
        reasonCode: "row_scope_unavailable",
        count: 2,
      }),
    ]);
    // 1 / 3 = 33.333...%
    expect(result?.evaluatedPercent).toBe(33.33);
  });

  it("reports 0% for a router group with zero total requests, never NaN or division by zero", () => {
    // Not reachable through perRouterCoverage's own grouping (a group only exists because a
    // row named it), but roundPercent's own zero-denominator guard is exercised via the
    // empty-report case above; this pins the percentage type stays a finite number always.
    const result = perRouterCoverage([
      bucket({ routerGroup: "webhook", outcome: "agree", count: 0 }),
    ]);
    expect(result[0]?.evaluatedPercent).toBe(0);
    expect(Number.isFinite(result[0]?.evaluatedPercent)).toBe(true);
  });

  it("throws on an unrecognised outcome instead of silently mis-bucketing it", () => {
    expect(() =>
      perRouterCoverage([
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid outcome, proving the exhaustiveness guard fires.
        bucket({ outcome: "not_a_real_outcome" as any }),
      ]),
    ).toThrow(/unknown shadow outcome/);
  });
});
