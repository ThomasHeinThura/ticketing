import { describe, expect, it } from "vitest";
import type {
  Guard,
  GuardContext,
  ProjectStateAdoption,
  TransitionOfferContext,
  Workflow,
  WorkflowState,
  WorkflowTransition,
  WorkflowVersion,
} from "./types.js";
import { asStateId, asStateTemplateId } from "./types.js";
import {
  evaluateGuard,
  evaluateGuards,
  filterOfferableForType,
  findLegalTransition,
  findReopenTransition,
  isClosedGroup,
  legalTransitions,
  noOutboundStateIds,
  noteBlocked,
  offerTransition,
  resolveEffects,
  resolveStateTemplateForProject,
  rolesWithNoLegalTransition,
  selectActiveVersion,
  unreachableStates,
  validateProjectStateSelection,
  validateWorkflowVersion,
} from "./workflow.js";

// Shorthand for the two branded constructors (types.ts) — used throughout this file's
// fixtures exactly as a real caller would use them at the one sanctioned boundary, just
// applied per-literal here since fixtures are literals rather than database rows.
const tid = asStateTemplateId;
const sid = asStateId;

// ---------------------------------------------------------------------------
// Fixtures — a seeded incident-style workflow, matching the spec's own worked example
// ("A member may move Open → In Progress. Only a lead may move In Progress →
// Resolved.") plus a cycle (in_progress ⇄ waiting_customer), a global Cancel
// (fromStateTemplateId: null, WF-5) and a reopen transition (WF-21). Every id here is a
// state **template** id — this module's transitions never reference a project's concrete
// state directly (`data-model.md` §3/§6).
// ---------------------------------------------------------------------------

const OPEN = tid("open");
const IN_PROGRESS = tid("in_progress");
const WAITING_CUSTOMER = tid("waiting_customer");
const RESOLVED = tid("resolved");
const CLOSED = tid("closed");
const CANCELLED = tid("cancelled");

const STATES: WorkflowState[] = [
  { id: OPEN, group: "unstarted" },
  { id: IN_PROGRESS, group: "started" },
  { id: WAITING_CUSTOMER, group: "started" },
  { id: RESOLVED, group: "completed" },
  { id: CLOSED, group: "completed" },
  { id: CANCELLED, group: "cancelled" },
];

function transition(
  overrides: Partial<WorkflowTransition> &
    Pick<WorkflowTransition, "id" | "toStateTemplateId">,
): WorkflowTransition {
  return {
    fromStateTemplateId: null,
    roleId: null,
    notePolicy: "none",
    noteVisibility: "internal",
    requiresApproval: false,
    approvalPolicy: null,
    requiresCab: false,
    isReopen: false,
    guards: [],
    effects: [],
    ...overrides,
  };
}

const T_OPEN_TO_PROGRESS = transition({
  id: "t1",
  fromStateTemplateId: OPEN,
  toStateTemplateId: IN_PROGRESS,
  roleId: null, // "a member may" — no restriction excludes anyone
});
const T_PROGRESS_TO_RESOLVED = transition({
  id: "t2",
  fromStateTemplateId: IN_PROGRESS,
  toStateTemplateId: RESOLVED,
  roleId: "lead", // "only a lead may"
  notePolicy: "required",
  noteVisibility: "public",
  requiresApproval: true,
  approvalPolicy: "any",
  guards: [{ type: "children_closed" }, { type: "no_open_blockers" }],
  effects: [
    { kind: "pause_sla" },
    { kind: "set_field", field: "resolution", value: "fixed" },
  ],
});
const T_PROGRESS_TO_WAITING = transition({
  id: "t3",
  fromStateTemplateId: IN_PROGRESS,
  toStateTemplateId: WAITING_CUSTOMER,
  roleId: null,
});
const T_WAITING_TO_PROGRESS = transition({
  id: "t4",
  fromStateTemplateId: WAITING_CUSTOMER,
  toStateTemplateId: IN_PROGRESS,
  roleId: null,
});
const T_RESOLVED_TO_CLOSED = transition({
  id: "t5",
  fromStateTemplateId: RESOLVED,
  toStateTemplateId: CLOSED,
  roleId: "lead",
});
const T_CANCEL = transition({
  id: "t6",
  fromStateTemplateId: null, // WF-5 — from any state template
  toStateTemplateId: CANCELLED,
  roleId: null,
});
const T_REOPEN = transition({
  id: "t7",
  fromStateTemplateId: CLOSED,
  toStateTemplateId: IN_PROGRESS,
  roleId: null,
  isReopen: true,
  effects: [{ kind: "resume_sla" }],
});

const SEEDED_TRANSITIONS: WorkflowTransition[] = [
  T_OPEN_TO_PROGRESS,
  T_PROGRESS_TO_RESOLVED,
  T_PROGRESS_TO_WAITING,
  T_WAITING_TO_PROGRESS,
  T_RESOLVED_TO_CLOSED,
  T_CANCEL,
  T_REOPEN,
];

function guardContext(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    allChildrenClosed: true,
    hasOpenBlockers: false,
    assigneePresent: true,
    fieldValues: {},
    changeRiskLevel: null,
    ...overrides,
  };
}

function offerContext(
  overrides: Partial<TransitionOfferContext> = {},
): TransitionOfferContext {
  return {
    ...guardContext(),
    approvalSatisfied: true,
    cabSatisfied: true,
    hasNote: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// legalTransitions / findLegalTransition — WF-3, WF-4, WF-5.
// ---------------------------------------------------------------------------

describe("legalTransitions — every (from, to, role) combination in the seeded workflow", () => {
  it("a member may move open → in_progress (null role matches everyone)", () => {
    const legal = legalTransitions(SEEDED_TRANSITIONS, OPEN, ["member"]);
    expect(legal.map((t) => t.id)).toEqual(["t1", "t6"]); // plus the global Cancel
    expect(legal).toContainEqual(T_OPEN_TO_PROGRESS);
  });

  it("a member may NOT move in_progress → resolved — that transition is simply absent", () => {
    const legal = legalTransitions(SEEDED_TRANSITIONS, IN_PROGRESS, ["member"]);
    expect(legal.map((t) => t.id)).toEqual(["t3", "t6"]); // waiting + cancel only, never t2
  });

  it("a lead may move in_progress → resolved", () => {
    const legal = legalTransitions(SEEDED_TRANSITIONS, IN_PROGRESS, ["lead"]);
    expect(legal.map((t) => t.id)).toContain("t2");
  });

  it("every state offers the global Cancel transition (WF-5, fromStateTemplateId: null)", () => {
    for (const state of STATES) {
      const legal = legalTransitions(SEEDED_TRANSITIONS, state.id, ["member"]);
      expect(legal.some((t) => t.id === "t6")).toBe(true);
    }
  });

  it("an actor holding no recognised role still gets null-role transitions, never a crash", () => {
    const legal = legalTransitions(SEEDED_TRANSITIONS, OPEN, ["nobody"]);
    expect(legal.map((t) => t.id)).toEqual(["t1", "t6"]);
  });

  it("an actor holding zero roles at all still gets null-role transitions", () => {
    const legal = legalTransitions(SEEDED_TRANSITIONS, OPEN, []);
    expect(legal.map((t) => t.id)).toEqual(["t1", "t6"]);
  });

  it("returns [] — not a throw — from a state with no matching transitions for this actor", () => {
    const onlyLeadOnly: WorkflowTransition[] = [
      transition({
        id: "x",
        fromStateTemplateId: OPEN,
        toStateTemplateId: CLOSED,
        roleId: "lead",
      }),
    ];
    expect(legalTransitions(onlyLeadOnly, OPEN, ["member"])).toEqual([]);
  });

  it("the empty workflow (no transitions at all) legalises nothing from any state", () => {
    expect(legalTransitions([], OPEN, ["member", "lead"])).toEqual([]);
  });
});

describe("legalTransitions — union of transitions for a multi-role actor", () => {
  const S = tid("s");
  const roleGated: WorkflowTransition[] = [
    transition({
      id: "a",
      fromStateTemplateId: S,
      toStateTemplateId: tid("a-out"),
      roleId: "role-a",
    }),
    transition({
      id: "b",
      fromStateTemplateId: S,
      toStateTemplateId: tid("b-out"),
      roleId: "role-b",
    }),
    transition({
      id: "c",
      fromStateTemplateId: S,
      toStateTemplateId: tid("c-out"),
      roleId: "role-c",
    }),
    transition({
      id: "n",
      fromStateTemplateId: S,
      toStateTemplateId: tid("n-out"),
      roleId: null,
    }),
  ];

  it("an actor holding role-a and role-b gets the union: a, b and the null-role one — never c", () => {
    const legal = legalTransitions(roleGated, S, ["role-a", "role-b"]);
    expect(legal.map((t) => t.id).sort()).toEqual(["a", "b", "n"]);
  });

  it("an actor holding only role-c gets exactly c and the null-role one", () => {
    const legal = legalTransitions(roleGated, S, ["role-c"]);
    expect(legal.map((t) => t.id).sort()).toEqual(["c", "n"]);
  });
});

describe("legalTransitions — self-transitions and cycles", () => {
  it("a self-transition (fromStateTemplateId === toStateTemplateId) is legal like any other", () => {
    const selfLoop = transition({
      id: "reassign",
      fromStateTemplateId: IN_PROGRESS,
      toStateTemplateId: IN_PROGRESS,
      roleId: null,
    });
    const legal = legalTransitions([selfLoop], IN_PROGRESS, ["member"]);
    expect(legal).toEqual([selfLoop]);
  });

  it("a two-state cycle (in_progress ⇄ waiting_customer) is legal in both directions", () => {
    expect(
      legalTransitions(SEEDED_TRANSITIONS, IN_PROGRESS, ["member"]).map(
        (t) => t.id,
      ),
    ).toContain("t3");
    expect(
      legalTransitions(SEEDED_TRANSITIONS, WAITING_CUSTOMER, ["member"]).map(
        (t) => t.id,
      ),
    ).toContain("t4");
  });
});

describe("findLegalTransition — WF-4's exact (current, target, role) match", () => {
  it("finds the transition when it is legal for this actor", () => {
    expect(
      findLegalTransition(SEEDED_TRANSITIONS, IN_PROGRESS, RESOLVED, ["lead"]),
    ).toBe(T_PROGRESS_TO_RESOLVED);
  });

  it("returns undefined — never throws — when the actor lacks the matching role (409, not a crash)", () => {
    expect(
      findLegalTransition(SEEDED_TRANSITIONS, IN_PROGRESS, RESOLVED, [
        "member",
      ]),
    ).toBeUndefined();
  });

  it("returns undefined when the target state is simply not reachable from here at all", () => {
    expect(
      findLegalTransition(SEEDED_TRANSITIONS, OPEN, CLOSED, ["lead"]),
    ).toBeUndefined();
  });

  it("returns undefined for a transition naming a target that isn't in this from-state's legal set even if it exists elsewhere", () => {
    expect(
      findLegalTransition(SEEDED_TRANSITIONS, CLOSED, RESOLVED, ["lead"]),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isClosedGroup — WF-15's own definition of "closed", never a state name.
// ---------------------------------------------------------------------------

describe("isClosedGroup", () => {
  it.each([
    ["backlog", false],
    ["unstarted", false],
    ["started", false],
    ["completed", true],
    ["cancelled", true],
  ] as const)("group=%s → closed=%s", (group, expected) => {
    expect(isClosedGroup(group)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// filterOfferableForType — WF-14, the CAB type-gate.
// ---------------------------------------------------------------------------

describe("filterOfferableForType — WF-14, never matched by a type's name", () => {
  const S = tid("s");
  const cabTransition = transition({
    id: "cab",
    fromStateTemplateId: S,
    toStateTemplateId: tid("e"),
    requiresCab: true,
  });
  const plainTransition = transition({
    id: "plain",
    fromStateTemplateId: S,
    toStateTemplateId: tid("f"),
  });
  const mixed = [cabTransition, plainTransition];

  it("on a change type, both are offered", () => {
    expect(
      filterOfferableForType(mixed, true)
        .map((t) => t.id)
        .sort(),
    ).toEqual(["cab", "plain"]);
  });

  it("on a non-change type, the CAB-requiring transition is absent entirely — never shown disabled", () => {
    expect(filterOfferableForType(mixed, false).map((t) => t.id)).toEqual([
      "plain",
    ]);
  });

  it("a workflow with no CAB transitions at all is unaffected either way", () => {
    expect(filterOfferableForType([plainTransition], false)).toEqual([
      plainTransition,
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveStateTemplateForProject — "Resolving a transition to a project's state"
// (workflows.md, WF-2), reused verbatim by schedule_transition's own resolution (WF-19).
// ---------------------------------------------------------------------------

describe("resolveStateTemplateForProject — WF-2's template-to-project-state resolution", () => {
  it("resolves a template this project has adopted to its own concrete state id", () => {
    const projectResolved = sid("resolved-42");
    const adopted: ProjectStateAdoption = new Map([
      [RESOLVED, projectResolved],
    ]);
    expect(resolveStateTemplateForProject(RESOLVED, adopted)).toEqual({
      ok: true,
      stateId: projectResolved,
    });
  });

  it("fails explicitly — never throws, never guesses — when the project has not adopted this template", () => {
    const adopted: ProjectStateAdoption = new Map([[OPEN, sid("open-1")]]); // no RESOLVED entry
    expect(resolveStateTemplateForProject(RESOLVED, adopted)).toEqual({
      ok: false,
      reason: "template_not_adopted",
      stateTemplateId: RESOLVED,
    });
  });

  it("an empty adoption map fails the same way for any template", () => {
    const adopted: ProjectStateAdoption = new Map();
    expect(resolveStateTemplateForProject(OPEN, adopted)).toEqual({
      ok: false,
      reason: "template_not_adopted",
      stateTemplateId: OPEN,
    });
  });

  it("resolves the target of a real seeded transition when the project has adopted every template it needs", () => {
    const projectA: ProjectStateAdoption = new Map([
      [OPEN, sid("a-open")],
      [IN_PROGRESS, sid("a-in-progress")],
      [WAITING_CUSTOMER, sid("a-waiting")],
      [RESOLVED, sid("a-resolved")],
      [CLOSED, sid("a-closed")],
      [CANCELLED, sid("a-cancelled")],
    ]);
    expect(
      resolveStateTemplateForProject(
        T_PROGRESS_TO_RESOLVED.toStateTemplateId,
        projectA,
      ),
    ).toEqual({ ok: true, stateId: sid("a-resolved") });
  });

  it("the same transition, resolved against a project that never adopted the target template, fails — a workflow shared by many projects meets exactly this", () => {
    const projectB: ProjectStateAdoption = new Map([
      [OPEN, sid("b-open")],
      [IN_PROGRESS, sid("b-in-progress")],
      // projectB never created a concrete state for RESOLVED.
    ]);
    expect(
      resolveStateTemplateForProject(
        T_PROGRESS_TO_RESOLVED.toStateTemplateId,
        projectB,
      ),
    ).toEqual({
      ok: false,
      reason: "template_not_adopted",
      stateTemplateId: RESOLVED,
    });
  });

  it("resolves schedule_transition's own toStateTemplateId with the identical function — WF-19 reuses WF-2's resolution, not a second one", () => {
    const scheduleEffect = {
      kind: "schedule_transition" as const,
      afterMinutes: 60,
      toStateTemplateId: tid("escalated"),
    };
    const adopted: ProjectStateAdoption = new Map([
      [scheduleEffect.toStateTemplateId, sid("proj-escalated")],
    ]);
    expect(
      resolveStateTemplateForProject(scheduleEffect.toStateTemplateId, adopted),
    ).toEqual({ ok: true, stateId: sid("proj-escalated") });
  });
});

// ---------------------------------------------------------------------------
// evaluateGuard / evaluateGuards — WF-15, WF-16.
// ---------------------------------------------------------------------------

describe("evaluateGuard — children_closed", () => {
  it("satisfied when every child is closed", () => {
    const result = evaluateGuard(
      { type: "children_closed" },
      guardContext({ allChildrenClosed: true }),
    );
    expect(result).toEqual({
      guard: { type: "children_closed" },
      ok: true,
      reasonCode: null,
    });
  });

  it("blocked, with reason code guard.children_closed, when a child is still open", () => {
    const result = evaluateGuard(
      { type: "children_closed" },
      guardContext({ allChildrenClosed: false }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("guard.children_closed");
  });
});

describe("evaluateGuard — no_open_blockers", () => {
  it("satisfied when there are no open blockers", () => {
    expect(
      evaluateGuard(
        { type: "no_open_blockers" },
        guardContext({ hasOpenBlockers: false }),
      ).ok,
    ).toBe(true);
  });

  it("blocked, with reason code guard.no_open_blockers, when a blocker is still open", () => {
    const result = evaluateGuard(
      { type: "no_open_blockers" },
      guardContext({ hasOpenBlockers: true }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("guard.no_open_blockers");
  });
});

describe("evaluateGuard — assignee_present", () => {
  it("satisfied when an assignee is set", () => {
    expect(
      evaluateGuard(
        { type: "assignee_present" },
        guardContext({ assigneePresent: true }),
      ).ok,
    ).toBe(true);
  });

  it("blocked, with reason code guard.assignee_present, when unassigned", () => {
    const result = evaluateGuard(
      { type: "assignee_present" },
      guardContext({ assigneePresent: false }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("guard.assignee_present");
  });
});

describe("evaluateGuard — field_required, every key style the spec names", () => {
  it("satisfied by a present native-column-style key", () => {
    const guard = { type: "field_required" as const, field: "assignee_id" };
    expect(
      evaluateGuard(guard, guardContext({ fieldValues: { assignee_id: "p1" } }))
        .ok,
    ).toBe(true);
  });

  it("satisfied by a present cf.<key> custom-field key", () => {
    const guard = { type: "field_required" as const, field: "cf.impact" };
    expect(
      evaluateGuard(
        guard,
        guardContext({ fieldValues: { "cf.impact": "high" } }),
      ).ok,
    ).toBe(true);
  });

  it("satisfied by a present dotted satellite key (change.rollback_plan)", () => {
    const guard = {
      type: "field_required" as const,
      field: "change.rollback_plan",
    };
    expect(
      evaluateGuard(
        guard,
        guardContext({
          fieldValues: { "change.rollback_plan": "roll back the release" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("blocked when the field is absent from the map entirely", () => {
    const guard = { type: "field_required" as const, field: "cf.impact" };
    const result = evaluateGuard(guard, guardContext({ fieldValues: {} }));
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("guard.field_required");
  });

  it("blocked when the value is explicitly null", () => {
    const guard = { type: "field_required" as const, field: "cf.impact" };
    expect(
      evaluateGuard(guard, guardContext({ fieldValues: { "cf.impact": null } }))
        .ok,
    ).toBe(false);
  });

  it("blocked when the value is an empty string — not a meaningful 'required' value", () => {
    const guard = { type: "field_required" as const, field: "cf.impact" };
    expect(
      evaluateGuard(guard, guardContext({ fieldValues: { "cf.impact": "" } }))
        .ok,
    ).toBe(false);
  });

  it("satisfied by a falsy-but-present value (0, false) — presence, not truthiness", () => {
    const guard = { type: "field_required" as const, field: "cf.count" };
    expect(
      evaluateGuard(guard, guardContext({ fieldValues: { "cf.count": 0 } })).ok,
    ).toBe(true);
    const boolGuard = { type: "field_required" as const, field: "cf.flag" };
    expect(
      evaluateGuard(
        boolGuard,
        guardContext({ fieldValues: { "cf.flag": false } }),
      ).ok,
    ).toBe(true);
  });
});

describe("evaluateGuard — change_risk_at_most, the full 3×3 level matrix", () => {
  const levels = ["low", "medium", "high"] as const;
  const rank = { low: 0, medium: 1, high: 2 };

  for (const guardLevel of levels) {
    for (const itemLevel of levels) {
      const shouldPass = rank[itemLevel] <= rank[guardLevel];
      it(`item risk ${itemLevel} vs guard "at most ${guardLevel}" → ${shouldPass ? "satisfied" : "blocked"}`, () => {
        const result = evaluateGuard(
          { type: "change_risk_at_most", level: guardLevel },
          guardContext({ changeRiskLevel: itemLevel }),
        );
        expect(result.ok).toBe(shouldPass);
      });
    }
  }

  it("fails closed — blocked, not satisfied — when the item carries no risk value at all", () => {
    const result = evaluateGuard(
      { type: "change_risk_at_most", level: "high" },
      guardContext({ changeRiskLevel: null }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("guard.change_risk_at_most");
  });
});

describe("evaluateGuards — preserves order and reports every guard, satisfied or not", () => {
  it("maps every guard through in order", () => {
    const results = evaluateGuards(
      [{ type: "assignee_present" }, { type: "children_closed" }],
      guardContext({ assigneePresent: false, allChildrenClosed: true }),
    );
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(results[0]?.reasonCode).toBe("guard.assignee_present");
    expect(results[1]?.reasonCode).toBeNull();
  });

  it("an empty guard list is trivially all-satisfied (vacuously)", () => {
    expect(evaluateGuards([], guardContext())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A guard type the `Guard` union does not know about.
//
// NOT a hypothetical. `workflow_transition.guards` is a `jsonb` column, so the union
// constrains this module's CALLERS and nothing else. A later migration, a hand-edited
// row, or a rolled-back deployment can all put an unknown `type` there.
//
// MEASURED BEFORE THE FIX, so these are not vacuous assertions:
//   evaluateGuard({type:"requires_signoff"}, ctx)  =>  undefined
//   offerTransition(... guards:[that] ...)         =>  THREW TypeError:
//                                                      Cannot read properties of
//                                                      undefined (reading 'ok')
// The switch had no `default:`, fell through, and returned `undefined`. That blocked
// the transition — but only by crashing, and only because nothing null-checked the
// result. The next person to "fix the crash" with `r?.ok` would have converted it into
// a silent pass: an authorization hole dressed as a null-safety fix.
// ---------------------------------------------------------------------------

describe("evaluateGuard — an unrecognized guard type fails CLOSED, and does not crash", () => {
  // Cast because the whole point is a value the union forbids but the database allows.
  const rogue = { type: "requires_signoff" } as unknown as Guard;

  it("is blocked, not satisfied", () => {
    const result = evaluateGuard(rogue, guardContext());
    expect(result.ok).toBe(false);
  });

  it("returns a defined result — nothing downstream can read `.ok` off undefined", () => {
    const result = evaluateGuard(rogue, guardContext());
    expect(result).not.toBeUndefined();
    expect(result.guard).toBe(rogue);
  });

  it("carries its OWN reason code, distinguishable from every real guard", () => {
    expect(evaluateGuard(rogue, guardContext()).reasonCode).toBe(
      "guard.unrecognized",
    );
  });

  it("does not masquerade as a known guard's failure", () => {
    const code = evaluateGuard(rogue, guardContext()).reasonCode;
    for (const known of [
      "guard.children_closed",
      "guard.no_open_blockers",
      "guard.assignee_present",
      "guard.field_required",
      "guard.change_risk_at_most",
    ]) {
      expect(code).not.toBe(known);
    }
  });

  it("blocks even when EVERY real fact in the context is satisfied", () => {
    // The context below satisfies every guard the union does know about. If the
    // unknown guard were skipped rather than refused, this transition would be offered.
    const result = evaluateGuard(
      rogue,
      guardContext({
        allChildrenClosed: true,
        hasOpenBlockers: false,
        assigneePresent: true,
        changeRiskLevel: "low",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("offerTransition refuses the transition instead of throwing", () => {
    const t = transition({
      id: "t-rogue",
      fromStateTemplateId: OPEN,
      toStateTemplateId: tid("done"),
      guards: [rogue],
    });
    const offer = offerTransition(t, offerContext());
    expect(offer.available).toBe(false);
    expect(offer.blockedBy).toEqual([
      { kind: "guard", reasonCode: "guard.unrecognized" },
    ]);
  });

  it("an unknown guard alongside satisfied real guards still blocks", () => {
    const t = transition({
      id: "t-mixed",
      fromStateTemplateId: OPEN,
      toStateTemplateId: tid("done"),
      guards: [{ type: "assignee_present" }, rogue],
    });
    const offer = offerTransition(t, offerContext({ assigneePresent: true }));
    expect(offer.available).toBe(false);
    expect(offer.blockedBy.map((b) => b.reasonCode)).toEqual([
      "guard.unrecognized",
    ]);
  });

  it("evaluateGuards maps it in order like any other guard", () => {
    const results = evaluateGuards(
      [rogue, { type: "assignee_present" }],
      guardContext({ assigneePresent: true }),
    );
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(results[0]?.reasonCode).toBe("guard.unrecognized");
  });
});

describe("evaluateGuard — the 'circular guard' edge case, at the runtime level", () => {
  // workflows.md's edge-case table: "A requires B closed, B requires A closed → Both
  // blocked." None of the five guard types names another workflow *state* directly, so
  // a static "detect the cycle before publish" function is not built here — see the
  // pull request description for why that is left as an open question rather than a
  // guess. What IS fully specified, and tested here, is the *runtime* half: two
  // independently-evaluated no_open_blockers guards, each blocked by the other work
  // item's still-open state, both correctly report blocked at the same time.
  it("two mutually-blocking guards both evaluate to blocked, simultaneously", () => {
    const guardForA = { type: "no_open_blockers" as const };
    const guardForB = { type: "no_open_blockers" as const };
    const contextSeenFromA = guardContext({ hasOpenBlockers: true }); // B is still open
    const contextSeenFromB = guardContext({ hasOpenBlockers: true }); // A is still open
    expect(evaluateGuard(guardForA, contextSeenFromA).ok).toBe(false);
    expect(evaluateGuard(guardForB, contextSeenFromB).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// noteBlocked — WF-10, all three policy values.
// ---------------------------------------------------------------------------

describe("noteBlocked — WF-10, every policy value × whether a note was supplied", () => {
  it.each([
    ["none", true, false],
    ["none", false, false],
    ["optional", true, false],
    ["optional", false, false],
    ["required", true, false],
    ["required", false, true],
  ] as const)(
    "policy=%s hasNote=%s → blocked=%s",
    (policy, hasNote, expected) => {
      const t = transition({
        id: "n",
        fromStateTemplateId: tid("s"),
        toStateTemplateId: tid("e"),
        notePolicy: policy,
      });
      expect(noteBlocked(t, hasNote)).toBe(expected);
    },
  );
});

// ---------------------------------------------------------------------------
// offerTransition — the composite "why is this blocked" answer for the state select.
// ---------------------------------------------------------------------------

describe("offerTransition", () => {
  const S = tid("s");
  const E = tid("e");

  it("is available with no blockers when every gate is satisfied", () => {
    const offer = offerTransition(T_PROGRESS_TO_RESOLVED, offerContext());
    expect(offer.available).toBe(true);
    expect(offer.blockedBy).toEqual([]);
  });

  it("reports a guard.<type> reason, distinguishable from other reasons, not a bare false", () => {
    const offer = offerTransition(
      T_PROGRESS_TO_RESOLVED,
      offerContext({ allChildrenClosed: false }),
    );
    expect(offer.available).toBe(false);
    expect(offer.blockedBy).toContainEqual({
      kind: "guard",
      reasonCode: "guard.children_closed",
    });
  });

  it("reports approval.pending distinctly from a guard failure", () => {
    const offer = offerTransition(
      T_PROGRESS_TO_RESOLVED,
      offerContext({ approvalSatisfied: false }),
    );
    expect(offer.blockedBy).toContainEqual({
      kind: "approval",
      reasonCode: "approval.pending",
    });
  });

  it("reports note.required distinctly when the policy is required and no note was given", () => {
    const offer = offerTransition(
      T_PROGRESS_TO_RESOLVED,
      offerContext({ hasNote: false }),
    );
    expect(offer.blockedBy).toContainEqual({
      kind: "note",
      reasonCode: "note.required",
    });
  });

  it("ignores approvalSatisfied entirely when the transition does not require approval", () => {
    const noApproval = transition({
      id: "x",
      fromStateTemplateId: S,
      toStateTemplateId: E,
    });
    const offer = offerTransition(
      noApproval,
      offerContext({ approvalSatisfied: false }),
    );
    expect(offer.available).toBe(true);
  });

  it("ignores cabSatisfied entirely when the transition does not require CAB", () => {
    const noCab = transition({
      id: "x",
      fromStateTemplateId: S,
      toStateTemplateId: E,
    });
    const offer = offerTransition(noCab, offerContext({ cabSatisfied: false }));
    expect(offer.available).toBe(true);
  });

  it("reports cab.pending, distinctly, when the transition requires CAB and it is not yet satisfied", () => {
    const requiresCab = transition({
      id: "x",
      fromStateTemplateId: S,
      toStateTemplateId: E,
      requiresCab: true,
    });
    const offer = offerTransition(
      requiresCab,
      offerContext({ cabSatisfied: false }),
    );
    expect(offer.available).toBe(false);
    expect(offer.blockedBy).toEqual([
      { kind: "cab", reasonCode: "cab.pending" },
    ]);
  });

  it("ignores hasNote entirely when the note policy is not required", () => {
    const optionalNote = transition({
      id: "x",
      fromStateTemplateId: S,
      toStateTemplateId: E,
      notePolicy: "optional",
    });
    const offer = offerTransition(
      optionalNote,
      offerContext({ hasNote: false }),
    );
    expect(offer.available).toBe(true);
  });

  it("collects every simultaneous blocker at once — not just the first", () => {
    const offer = offerTransition(
      T_PROGRESS_TO_RESOLVED,
      offerContext({
        allChildrenClosed: false,
        hasOpenBlockers: true,
        approvalSatisfied: false,
        hasNote: false,
      }),
    );
    expect(offer.available).toBe(false);
    const codes = offer.blockedBy.map((b) => b.reasonCode).sort();
    expect(codes).toEqual(
      [
        "approval.pending",
        "guard.children_closed",
        "guard.no_open_blockers",
        "note.required",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveEffects — WF-17, WF-18, WF-19. Named, never executed.
// ---------------------------------------------------------------------------

describe("resolveEffects — the full effects vocabulary, named but not run", () => {
  it("returns the transition's effects, in order", () => {
    expect(resolveEffects(T_PROGRESS_TO_RESOLVED)).toEqual([
      { kind: "pause_sla" },
      { kind: "set_field", field: "resolution", value: "fixed" },
    ]);
  });

  it("returns [] for a transition with no effects", () => {
    const t = transition({
      id: "x",
      fromStateTemplateId: tid("s"),
      toStateTemplateId: tid("e"),
    });
    expect(resolveEffects(t)).toEqual([]);
  });

  it("returns a fresh array, never the transition's own array reference — a caller cannot mutate the transition through it", () => {
    const effects = resolveEffects(T_PROGRESS_TO_RESOLVED);
    expect(effects).not.toBe(T_PROGRESS_TO_RESOLVED.effects);
  });

  it("preserves every effect kind exactly, for a transition that carries all six", () => {
    const allSix = transition({
      id: "kitchen-sink",
      fromStateTemplateId: tid("s"),
      toStateTemplateId: tid("e"),
      effects: [
        { kind: "set_assignee", personId: "default" },
        { kind: "set_assignee", personId: "p123" },
        { kind: "clear_assignee" },
        { kind: "pause_sla" },
        { kind: "resume_sla" },
        { kind: "set_field", field: "cf.impact", value: "high" },
        {
          kind: "schedule_transition",
          afterMinutes: 60,
          toStateTemplateId: tid("escalated"),
        },
      ],
    });
    expect(resolveEffects(allSix)).toEqual(allSix.effects);
  });

  it("the reopen transition's effect vocabulary names resume_sla — WF-21's resume-not-restart, at the naming level", () => {
    expect(resolveEffects(T_REOPEN)).toEqual([{ kind: "resume_sla" }]);
  });
});

// ---------------------------------------------------------------------------
// findReopenTransition — WF-21.
// ---------------------------------------------------------------------------

describe("findReopenTransition", () => {
  it("finds the version's single reopen transition", () => {
    expect(findReopenTransition(SEEDED_TRANSITIONS)).toBe(T_REOPEN);
  });

  it("returns null — never throws — when the version has none", () => {
    expect(
      findReopenTransition([T_OPEN_TO_PROGRESS, T_PROGRESS_TO_WAITING]),
    ).toBeNull();
  });

  it("returns null for the empty transition list", () => {
    expect(findReopenTransition([])).toBeNull();
  });

  it("is found independent of role — the reopen path is executed as a system actor, not through role legality", () => {
    // No actor/role argument exists on this function at all; this test documents that
    // omission is deliberate, not an oversight.
    expect(findReopenTransition(SEEDED_TRANSITIONS)?.roleId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectActiveVersion — WF-6, WF-7, WF-8.
// ---------------------------------------------------------------------------

describe("selectActiveVersion", () => {
  const v1: WorkflowVersion = { id: "v1", transitions: [] };
  const v2: WorkflowVersion = { id: "v2", transitions: SEEDED_TRANSITIONS };

  it("returns the version matching activeVersionId", () => {
    const workflow: Workflow = { id: "wf1", activeVersionId: "v2" };
    expect(selectActiveVersion(workflow, [v1, v2])).toBe(v2);
  });

  it("returns undefined when the workflow has no active version yet (draft-only)", () => {
    const workflow: Workflow = { id: "wf1", activeVersionId: null };
    expect(selectActiveVersion(workflow, [v1, v2])).toBeUndefined();
  });

  it("returns undefined — never throws — for a dangling activeVersionId not in the list", () => {
    const workflow: Workflow = { id: "wf1", activeVersionId: "v99" };
    expect(selectActiveVersion(workflow, [v1, v2])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// noOutboundStateIds — the validation panel's "stuck" / terminal-template core.
// ---------------------------------------------------------------------------

describe("noOutboundStateIds — terminal state templates: nothing leaves them", () => {
  it("a template with zero transitions naming it as fromStateTemplateId, and no any-template transition, is reported", () => {
    const states: WorkflowState[] = [
      { id: tid("dead_end"), group: "completed" },
    ];
    expect(noOutboundStateIds(states, [])).toEqual(["dead_end"]);
  });

  it("legalTransitions independently confirms the same template offers nothing to anyone", () => {
    const deadEndTransitions: WorkflowTransition[] = [
      transition({
        id: "into",
        fromStateTemplateId: OPEN,
        toStateTemplateId: tid("dead_end"),
      }),
    ];
    expect(
      legalTransitions(deadEndTransitions, tid("dead_end"), ["member", "lead"]),
    ).toEqual([]);
  });

  it("a global Cancel (fromStateTemplateId: null) counts as an outbound path for every template, including otherwise dead ends", () => {
    const states: WorkflowState[] = [
      { id: tid("a"), group: "started" },
      { id: tid("b"), group: "completed" },
    ];
    const withCancel: WorkflowTransition[] = [T_CANCEL];
    expect(noOutboundStateIds(states, withCancel)).toEqual([]);
  });

  it("in the seeded workflow, every template has an outbound path (Cancel covers all)", () => {
    expect(noOutboundStateIds(STATES, SEEDED_TRANSITIONS)).toEqual([]);
  });

  it("without the global Cancel, only templates with a genuine outbound transition are clear", () => {
    const withoutCancel = SEEDED_TRANSITIONS.filter((t) => t.id !== "t6");
    // "cancelled" has no outbound transition of its own once Cancel itself is removed.
    expect(noOutboundStateIds(STATES, withoutCancel)).toEqual(["cancelled"]);
  });

  it("a template referenced only as a to-template, never a from-template, is reported (without a global any-template transition)", () => {
    const states: WorkflowState[] = [
      { id: tid("start"), group: "unstarted" },
      { id: tid("terminal"), group: "completed" },
    ];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t",
        fromStateTemplateId: tid("start"),
        toStateTemplateId: tid("terminal"),
      }),
    ];
    expect(noOutboundStateIds(states, transitions)).toEqual(["terminal"]);
  });
});

// ---------------------------------------------------------------------------
// unreachableStates.
// ---------------------------------------------------------------------------

describe("unreachableStates", () => {
  it("every template in the seeded workflow is reachable from open", () => {
    expect(unreachableStates(STATES, SEEDED_TRANSITIONS, [OPEN])).toEqual([]);
  });

  it("a template with no inbound transition at all, and no any-template transition reaching it, is unreachable", () => {
    const start = tid("start");
    const island = tid("island");
    const states: WorkflowState[] = [
      { id: start, group: "unstarted" },
      { id: island, group: "started" },
    ];
    expect(unreachableStates(states, [], [start])).toEqual(["island"]);
  });

  it("a two-state cycle (A ⇄ B) is fully reachable once entered — a cycle is not itself unreachable", () => {
    const start = tid("start");
    const a = tid("a");
    const b = tid("b");
    const states: WorkflowState[] = [
      { id: start, group: "unstarted" },
      { id: a, group: "started" },
      { id: b, group: "started" },
    ];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "into",
        fromStateTemplateId: start,
        toStateTemplateId: a,
      }),
      transition({ id: "ab", fromStateTemplateId: a, toStateTemplateId: b }),
      transition({ id: "ba", fromStateTemplateId: b, toStateTemplateId: a }),
    ];
    expect(unreachableStates(states, transitions, [start])).toEqual([]);
  });

  it("an any-template transition's target becomes reachable the moment anything at all is reachable", () => {
    const start = tid("start");
    const states: WorkflowState[] = [
      { id: start, group: "unstarted" },
      { id: CANCELLED, group: "cancelled" },
    ];
    const transitions: WorkflowTransition[] = [T_CANCEL];
    expect(unreachableStates(states, transitions, [start])).toEqual([]);
  });

  it("with no initial template supplied at all, nothing is reachable except via an any-template transition — everything else is reported", () => {
    const states: WorkflowState[] = [
      { id: OPEN, group: "unstarted" },
      { id: IN_PROGRESS, group: "started" },
    ];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t",
        fromStateTemplateId: OPEN,
        toStateTemplateId: IN_PROGRESS,
      }),
    ];
    expect(unreachableStates(states, transitions, [])).toEqual([
      "open",
      "in_progress",
    ]);
  });

  it("the single-template workflow with no transitions: the lone template is reachable exactly because it is the initial template", () => {
    const only = tid("only");
    const states: WorkflowState[] = [{ id: only, group: "unstarted" }];
    expect(unreachableStates(states, [], [only])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rolesWithNoLegalTransition.
// ---------------------------------------------------------------------------

describe("rolesWithNoLegalTransition", () => {
  it("a role named on a transition is never reported", () => {
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t",
        fromStateTemplateId: tid("a"),
        toStateTemplateId: tid("b"),
        roleId: "lead",
      }),
    ];
    expect(rolesWithNoLegalTransition(transitions, ["lead"])).toEqual([]);
  });

  it("a role never named anywhere, with no null-role transition either, is reported", () => {
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t",
        fromStateTemplateId: tid("a"),
        toStateTemplateId: tid("b"),
        roleId: "lead",
      }),
    ];
    expect(rolesWithNoLegalTransition(transitions, ["lead", "viewer"])).toEqual(
      ["viewer"],
    );
  });

  it("any null-role transition means every role has a legal transition — nothing is reported", () => {
    expect(
      rolesWithNoLegalTransition(SEEDED_TRANSITIONS, [
        "member",
        "lead",
        "viewer",
      ]),
    ).toEqual([]);
  });

  it("an empty roster reports nothing", () => {
    expect(rolesWithNoLegalTransition([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateWorkflowVersion — structural, fail-closed checks on malformed input.
// ---------------------------------------------------------------------------

describe("validateWorkflowVersion — the well-formed seeded workflow", () => {
  it("is valid, with no errors", () => {
    expect(validateWorkflowVersion(STATES, SEEDED_TRANSITIONS)).toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe("validateWorkflowVersion — malformed input, fails closed", () => {
  it("rejects a workflow with a duplicate state id", () => {
    const dup = tid("dup");
    const states: WorkflowState[] = [
      { id: dup, group: "started" },
      { id: dup, group: "completed" },
    ];
    const result = validateWorkflowVersion(states, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate state id"))).toBe(
      true,
    );
  });

  it("rejects a transition naming a from-state that does not exist", () => {
    const states: WorkflowState[] = [{ id: tid("a"), group: "started" }];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t",
        fromStateTemplateId: tid("ghost"),
        toStateTemplateId: tid("a"),
      }),
    ];
    const result = validateWorkflowVersion(states, transitions);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("from-state that does not exist")),
    ).toBe(true);
  });

  it("rejects a transition naming a to-state that does not exist", () => {
    const states: WorkflowState[] = [{ id: tid("a"), group: "started" }];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t",
        fromStateTemplateId: tid("a"),
        toStateTemplateId: tid("ghost"),
      }),
    ];
    const result = validateWorkflowVersion(states, transitions);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("to-state that does not exist")),
    ).toBe(true);
  });

  it("accepts fromStateTemplateId: null (any-state) without treating it as a dangling reference", () => {
    const states: WorkflowState[] = [{ id: tid("a"), group: "started" }];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t",
        fromStateTemplateId: null,
        toStateTemplateId: tid("a"),
      }),
    ];
    expect(validateWorkflowVersion(states, transitions).valid).toBe(true);
  });

  it("rejects a workflow with no states at all", () => {
    const result = validateWorkflowVersion([], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no states"))).toBe(true);
  });

  it("rejects more than one isReopen transition per version", () => {
    const a = tid("a");
    const b = tid("b");
    const states: WorkflowState[] = [
      { id: a, group: "started" },
      { id: b, group: "completed" },
    ];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "r1",
        fromStateTemplateId: b,
        toStateTemplateId: a,
        isReopen: true,
      }),
      transition({
        id: "r2",
        fromStateTemplateId: b,
        toStateTemplateId: a,
        roleId: "lead",
        isReopen: true,
      }),
    ];
    const result = validateWorkflowVersion(states, transitions);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("reopen transitions"))).toBe(
      true,
    );
  });

  it("accepts exactly one isReopen transition", () => {
    const a = tid("a");
    const b = tid("b");
    const states: WorkflowState[] = [
      { id: a, group: "started" },
      { id: b, group: "completed" },
    ];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "r1",
        fromStateTemplateId: b,
        toStateTemplateId: a,
        isReopen: true,
      }),
    ];
    expect(validateWorkflowVersion(states, transitions).valid).toBe(true);
  });

  it("rejects a duplicate (fromStateTemplateId, toStateTemplateId, roleId) transition tuple", () => {
    const a = tid("a");
    const b = tid("b");
    const states: WorkflowState[] = [
      { id: a, group: "started" },
      { id: b, group: "completed" },
    ];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t1",
        fromStateTemplateId: a,
        toStateTemplateId: b,
        roleId: "lead",
      }),
      transition({
        id: "t2",
        fromStateTemplateId: a,
        toStateTemplateId: b,
        roleId: "lead",
      }),
    ];
    const result = validateWorkflowVersion(states, transitions);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate transition"))).toBe(
      true,
    );
  });

  it("rejects a duplicate among two any-state (fromStateTemplateId: null) transitions too", () => {
    const a = tid("a");
    const states: WorkflowState[] = [{ id: a, group: "cancelled" }];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t1",
        fromStateTemplateId: null,
        toStateTemplateId: a,
        roleId: null,
      }),
      transition({
        id: "t2",
        fromStateTemplateId: null,
        toStateTemplateId: a,
        roleId: null,
      }),
    ];
    const result = validateWorkflowVersion(states, transitions);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate transition"))).toBe(
      true,
    );
  });

  it("the same (from, to) pair for two DIFFERENT roles is not a duplicate", () => {
    const a = tid("a");
    const b = tid("b");
    const states: WorkflowState[] = [
      { id: a, group: "started" },
      { id: b, group: "completed" },
    ];
    const transitions: WorkflowTransition[] = [
      transition({
        id: "t1",
        fromStateTemplateId: a,
        toStateTemplateId: b,
        roleId: "lead",
      }),
      transition({
        id: "t2",
        fromStateTemplateId: a,
        toStateTemplateId: b,
        roleId: "member",
      }),
    ];
    expect(validateWorkflowVersion(states, transitions).valid).toBe(true);
  });
});

describe("validateWorkflowVersion — the single-state workflow", () => {
  it("a single state and zero transitions is structurally valid (though noOutboundStateIds flags it as a dead end)", () => {
    const only = tid("only");
    const states: WorkflowState[] = [{ id: only, group: "unstarted" }];
    expect(validateWorkflowVersion(states, []).valid).toBe(true);
    expect(noOutboundStateIds(states, [])).toEqual(["only"]);
  });
});

// ---------------------------------------------------------------------------
// validateProjectStateSelection — WF-2, and the "no initial state" malformed case.
//
// A workflow version carries no "initial state" field of its own (data-model.md: the
// default is realised by `state.is_default` on the project's own concrete row — the
// retired `project_state` table this once lived on is gone). The generic state-machine
// expectation "a workflow with no initial state must fail closed" is modelled here as
// exactly that: a project with no default template selected at all.
// ---------------------------------------------------------------------------

describe("validateProjectStateSelection — WF-2", () => {
  it("is valid when every enabled template has an outbound transition and a default is selected", () => {
    const result = validateProjectStateSelection(
      SEEDED_TRANSITIONS,
      [OPEN, IN_PROGRESS],
      OPEN,
    );
    expect(result).toEqual({ valid: true, refusedStateIds: [], errors: [] });
  });

  it("fails closed — 'no initial state' — when no default state is selected at all", () => {
    const result = validateProjectStateSelection(
      SEEDED_TRANSITIONS,
      [OPEN, IN_PROGRESS],
      null,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("no default state selected")),
    ).toBe(true);
  });

  it("fails closed when the selected default is not one of the enabled states", () => {
    const result = validateProjectStateSelection(
      SEEDED_TRANSITIONS,
      [OPEN],
      IN_PROGRESS,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("not one of the project's enabled states"),
      ),
    ).toBe(true);
  });

  it("refuses enabling a template the workflow has no outbound transition from, and names it", () => {
    const noOutboundTransitions = SEEDED_TRANSITIONS.filter(
      (t) => t.id !== "t6",
    ); // drop global Cancel
    const result = validateProjectStateSelection(
      noOutboundTransitions,
      [OPEN, CANCELLED],
      OPEN,
    );
    expect(result.valid).toBe(false);
    expect(result.refusedStateIds).toEqual(["cancelled"]);
  });

  it("a global any-state transition (Cancel) means no enabled template is ever refused on this ground", () => {
    const result = validateProjectStateSelection(
      SEEDED_TRANSITIONS,
      STATES.map((s) => s.id),
      OPEN,
    );
    expect(result.refusedStateIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The empty workflow, end to end.
// ---------------------------------------------------------------------------

describe("the empty workflow", () => {
  it("has no states, so validateWorkflowVersion refuses it", () => {
    expect(validateWorkflowVersion([], []).valid).toBe(false);
  });

  it("legalTransitions and findLegalTransition both answer 'nothing', not throw", () => {
    expect(legalTransitions([], tid("anything"), ["any-role"])).toEqual([]);
    expect(
      findLegalTransition([], tid("anything"), tid("else"), ["any-role"]),
    ).toBeUndefined();
  });

  it("findReopenTransition answers null", () => {
    expect(findReopenTransition([])).toBeNull();
  });
});
