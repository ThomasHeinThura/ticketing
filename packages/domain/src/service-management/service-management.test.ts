import { describe, expect, it } from "vitest";
import {
  approvalFreezeWindow,
  decideFreeze,
  findChangeConflicts,
  freezesCoveringWindow,
  generateReleaseNotes,
  hasRollbackPlan,
  isChangeApprovalEdge,
  isRetrospectiveWindow,
  rangesOverlap,
  requiresCabApproval,
  traverseImpact,
  wouldCreateCycle,
} from "./service-management.js";

const d = (iso: string) => new Date(iso);
const range = (a: string, b: string) => ({ start: d(a), end: d(b) });

describe("requiresCabApproval (CH-3)", () => {
  it("always requires CAB for high risk, whatever the ceiling", () => {
    expect(requiresCabApproval("high", "high")).toBe(true);
    expect(requiresCabApproval("high", "low")).toBe(true);
  });
  it("requires CAB when risk is unset or no pre-approval ceiling exists", () => {
    expect(requiresCabApproval(null, "high")).toBe(true);
    expect(requiresCabApproval("low", null)).toBe(true);
  });
  it("pre-approves a risk at or below the ceiling", () => {
    expect(requiresCabApproval("low", "low")).toBe(false);
    expect(requiresCabApproval("low", "medium")).toBe(false);
    expect(requiresCabApproval("medium", "medium")).toBe(false);
    expect(requiresCabApproval("medium", "low")).toBe(true);
  });
});

describe("window and freeze overlap (CH-4)", () => {
  it("treats ranges as half-open", () => {
    expect(
      rangesOverlap(
        range("2026-01-01T00:00Z", "2026-01-02T00:00Z"),
        range("2026-01-02T00:00Z", "2026-01-03T00:00Z"),
      ),
    ).toBe(false);
    expect(
      rangesOverlap(
        range("2026-01-01T00:00Z", "2026-01-02T00:00Z"),
        range("2026-01-01T23:59Z", "2026-01-03T00:00Z"),
      ),
    ).toBe(true);
  });

  const freeze = {
    id: "f1",
    ...range("2026-12-20T00:00Z", "2027-01-02T00:00Z"),
    version: 1,
  };

  it("ignores cancelled freezes and invalid windows", () => {
    const window = range("2026-12-24T00:00Z", "2026-12-24T04:00Z");
    expect(
      freezesCoveringWindow(window, [
        { ...freeze, cancelledAt: d("2026-12-01") },
      ]),
    ).toEqual([]);
    expect(
      freezesCoveringWindow(range("2026-12-24T04:00Z", "2026-12-24T00:00Z"), [
        freeze,
      ]),
    ).toEqual([]);
  });

  it("blocks a change inside a freeze unless overridden", () => {
    const window = range("2026-12-24T00:00Z", "2026-12-24T04:00Z");
    expect(
      decideFreeze({ window, freezes: [freeze], overrideGranted: false }),
    ).toEqual({
      blocked: true,
      reason: "frozen",
      freezeIds: ["f1"],
    });
    expect(
      decideFreeze({
        window,
        freezes: [freeze],
        overrideGranted: true,
        overrideFreezes: [{ id: "f1", version: 1 }],
      }),
    ).toEqual({
      blocked: false,
      reason: "overridden",
    });
  });

  it("holds a change with no window against the freezes covering now (P5-R4-03)", () => {
    const now = d("2026-12-24T01:00Z");
    const window = approvalFreezeWindow(null, now);
    expect(window.end.getTime() - window.start.getTime()).toBe(1);
    expect(
      decideFreeze({ window, freezes: [freeze], overrideGranted: false }),
    ).toMatchObject({ blocked: true });
    expect(
      decideFreeze({
        window: approvalFreezeWindow(null, d("2027-01-05T00:00Z")),
        freezes: [freeze],
        overrideGranted: false,
      }),
    ).toEqual({ blocked: false, reason: "no_freeze" });
    const planned = range("2026-11-01T00:00Z", "2026-11-01T02:00Z");
    expect(approvalFreezeWindow(planned, now)).toBe(planned);
  });

  it("allows a change outside every freeze or with no window", () => {
    expect(
      decideFreeze({
        window: range("2026-11-01T00:00Z", "2026-11-01T02:00Z"),
        freezes: [freeze],
        overrideGranted: false,
      }),
    ).toEqual({ blocked: false, reason: "no_freeze" });
    expect(
      decideFreeze({ window: null, freezes: [freeze], overrideGranted: false }),
    ).toEqual({ blocked: false, reason: "no_window" });
  });
});

describe("an override covers only the freezes it was recorded for (P5-R5-02)", () => {
  const a = {
    id: "a",
    ...range("2026-12-20T00:00Z", "2027-01-02T00:00Z"),
    version: 1,
  };
  const b = {
    id: "b",
    ...range("2026-12-23T00:00Z", "2027-01-05T00:00Z"),
    version: 3,
  };
  const window = range("2026-12-24T00:00Z", "2026-12-24T04:00Z");

  it("stays overridden for a recorded freeze that is unchanged", () => {
    expect(
      decideFreeze({
        window,
        freezes: [a],
        overrideGranted: true,
        overrideFreezes: [{ id: "a", version: 1 }],
      }),
    ).toEqual({ blocked: false, reason: "overridden" });
  });

  it("blocks a covering freeze the override never named, even when it is older", () => {
    expect(
      decideFreeze({
        window,
        freezes: [a, b],
        overrideGranted: true,
        overrideFreezes: [{ id: "a", version: 1 }],
      }),
    ).toEqual({ blocked: true, reason: "frozen", freezeIds: ["b"] });
  });

  it("blocks again once a recorded freeze was edited", () => {
    expect(
      decideFreeze({
        window,
        freezes: [{ ...a, version: 2 }],
        overrideGranted: true,
        overrideFreezes: [{ id: "a", version: 1 }],
      }),
    ).toEqual({ blocked: true, reason: "frozen", freezeIds: ["a"] });
  });

  it("treats a flag with no recorded freezes, or a freeze with no version, as covering nothing", () => {
    expect(
      decideFreeze({ window, freezes: [a], overrideGranted: true }),
    ).toMatchObject({ blocked: true });
    expect(
      decideFreeze({
        window,
        freezes: [{ ...a, version: undefined }],
        overrideGranted: true,
        overrideFreezes: [{ id: "a", version: 1 }],
      }),
    ).toMatchObject({ blocked: true });
  });
});

describe("change approval edges", () => {
  it("includes CAB edges and risk-guarded pre-approval edges, nothing else", () => {
    expect(isChangeApprovalEdge({ requiresCab: true, guards: [] })).toBe(true);
    expect(
      isChangeApprovalEdge({
        requiresCab: false,
        guards: [{ type: "change_risk_at_most" }],
      }),
    ).toBe(true);
    expect(
      isChangeApprovalEdge({
        requiresCab: false,
        guards: [{ type: "assignee_present" }],
      }),
    ).toBe(false);
  });
});

describe("rollback plan and retrospective window", () => {
  it("requires a non-blank rollback plan (CH-6)", () => {
    expect(hasRollbackPlan(null)).toBe(false);
    expect(hasRollbackPlan("   ")).toBe(false);
    expect(hasRollbackPlan("Revert the deploy")).toBe(true);
  });
  it("marks a past window retrospective", () => {
    const window = range("2026-01-01T00:00Z", "2026-01-01T02:00Z");
    expect(isRetrospectiveWindow(window, d("2026-02-01T00:00Z"))).toBe(true);
    expect(isRetrospectiveWindow(window, d("2026-01-01T01:00Z"))).toBe(false);
  });
});

describe("findChangeConflicts (CH-5)", () => {
  it("flags only overlapping windows that share a service", () => {
    const conflicts = findChangeConflicts([
      {
        id: "c1",
        window: range("2026-05-01T00:00Z", "2026-05-01T06:00Z"),
        serviceIds: ["a", "b"],
      },
      {
        id: "c2",
        window: range("2026-05-01T05:00Z", "2026-05-01T08:00Z"),
        serviceIds: ["b", "c"],
      },
      {
        id: "c3",
        window: range("2026-05-01T05:00Z", "2026-05-01T08:00Z"),
        serviceIds: ["z"],
      },
      {
        id: "c4",
        window: range("2026-05-02T00:00Z", "2026-05-02T06:00Z"),
        serviceIds: ["b"],
      },
    ]);
    expect(conflicts).toEqual([{ changeIds: ["c1", "c2"], serviceIds: ["b"] }]);
  });
});

describe("traverseImpact (SVC-5)", () => {
  // web depends on api, api depends on db, batch depends on db
  const edges = [
    { serviceId: "web", dependsOnServiceId: "api" },
    { serviceId: "api", dependsOnServiceId: "db" },
    { serviceId: "batch", dependsOnServiceId: "db" },
  ];
  it("lists dependents level by level", () => {
    const result = traverseImpact("db", edges);
    expect(result.impacted).toEqual([
      { serviceId: "api", depth: 1, viaServiceId: "db" },
      { serviceId: "batch", depth: 1, viaServiceId: "db" },
      { serviceId: "web", depth: 2, viaServiceId: "api" },
    ]);
    expect(result.cycleDetected).toBe(false);
  });
  it("is empty for a leaf", () => {
    expect(traverseImpact("web", edges).impacted).toEqual([]);
  });
  it("does not call a diamond a cycle", () => {
    const diamond = [
      { serviceId: "b", dependsOnServiceId: "a" },
      { serviceId: "c", dependsOnServiceId: "a" },
      { serviceId: "d", dependsOnServiceId: "b" },
      { serviceId: "d", dependsOnServiceId: "c" },
    ];
    const result = traverseImpact("a", diamond);
    expect(result.impacted.map((n) => n.serviceId)).toEqual(["b", "c", "d"]);
    expect(result.cycleDetected).toBe(false);
  });
  it("stops at a cycle and reports it", () => {
    const cyc = [
      { serviceId: "b", dependsOnServiceId: "a" },
      { serviceId: "c", dependsOnServiceId: "b" },
      { serviceId: "a", dependsOnServiceId: "c" },
    ];
    const result = traverseImpact("a", cyc);
    expect(result.impacted.map((n) => n.serviceId)).toEqual(["b", "c"]);
    expect(result.cycleDetected).toBe(true);
    expect(result.cycleServiceIds).toEqual(["a"]);
  });
  it("detects when a new edge would close a cycle", () => {
    expect(wouldCreateCycle("db", "web", edges)).toBe(true);
    expect(wouldCreateCycle("web", "batch", edges)).toBe(false);
    expect(wouldCreateCycle("x", "x", edges)).toBe(true);
  });
});

describe("generateReleaseNotes (REL-4)", () => {
  it("says so when the release has no changes", () => {
    expect(generateReleaseNotes("R1", [])).toContain("No changes");
  });
  it("groups changes by type", () => {
    const notes = generateReleaseNotes("R1", [
      { key: "OPS-2", title: "Patch", typeName: "Change" },
      { key: "OPS-1", title: "Upgrade", typeName: "Change" },
      { key: "OPS-9", title: "Fix", typeName: "Bug" },
    ]);
    expect(notes).toBe(
      "# R1\n\n## Bug\n\n- OPS-9: Fix\n\n## Change\n\n- OPS-1: Upgrade\n- OPS-2: Patch\n",
    );
  });
});
