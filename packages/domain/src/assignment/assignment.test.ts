import { describe, expect, it } from "vitest";
import {
  evaluateAssigneeEligibility,
  planAssignment,
  resolveAssigneeDisplayStatus,
} from "./assignment.js";
import type { AssigneeDisplayFacts } from "./types.js";

const ALICE = "person-alice";
const BOB = "person-bob";
const CAROL = "person-carol";

// ---------------------------------------------------------------------------
// Eligibility — AS-5, generalised (active + on roster).
// ---------------------------------------------------------------------------

describe("evaluateAssigneeEligibility", () => {
  const cases: Array<{
    name: string;
    active: boolean;
    onRoster: boolean;
    expected: ReturnType<typeof evaluateAssigneeEligibility>;
  }> = [
    {
      name: "active and on roster",
      active: true,
      onRoster: true,
      expected: { eligible: true },
    },
    {
      name: "not on roster (active)",
      active: true,
      onRoster: false,
      expected: { eligible: false, reason: "not_on_roster" },
    },
    {
      name: "inactive but on roster",
      active: false,
      onRoster: true,
      expected: { eligible: false, reason: "not_active" },
    },
    {
      name: "inactive and not on roster — roster reason wins",
      active: false,
      onRoster: false,
      expected: { eligible: false, reason: "not_on_roster" },
    },
  ];

  it.each(cases)("$name", ({ active, onRoster, expected }) => {
    expect(evaluateAssigneeEligibility({ active, onRoster })).toEqual(expected);
  });

  it("is deterministic", () => {
    const input = { active: true, onRoster: false };
    expect(evaluateAssigneeEligibility(input)).toEqual(
      evaluateAssigneeEligibility(input),
    );
  });

  // Mutation check 1: flip the roster check from `!standing.onRoster` to
  // `standing.onRoster` and this case must fail.
  it("mutation guard: not-on-roster must be ineligible, not eligible", () => {
    const result = evaluateAssigneeEligibility({
      active: true,
      onRoster: false,
    });
    expect(result.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defaults — AS-11, AS-12, and the "default assignee is inactive" edge case.
// ---------------------------------------------------------------------------

describe("planAssignment", () => {
  const cases: Array<{
    name: string;
    current: string | null;
    next: string | null;
    actor: string;
    expected: ReturnType<typeof planAssignment>;
  }> = [
    {
      name: "already assigned to you — no-op, no notification",
      current: ALICE,
      next: ALICE,
      actor: ALICE,
      expected: { action: "noop", requiresConfirmation: false, notify: [] },
    },
    {
      name: "already assigned to the same person by another actor — still a no-op",
      current: ALICE,
      next: ALICE,
      actor: BOB,
      expected: { action: "noop", requiresConfirmation: false, notify: [] },
    },
    {
      name: "both unassigned already — no-op",
      current: null,
      next: null,
      actor: BOB,
      expected: { action: "noop", requiresConfirmation: false, notify: [] },
    },
    {
      name: "fresh assign to someone else — AS-16 notifies them, no confirmation",
      current: null,
      next: BOB,
      actor: ALICE,
      expected: {
        action: "assign",
        requiresConfirmation: false,
        notify: [BOB],
      },
    },
    {
      name: "AS-18: assigning yourself (fresh) never notifies you",
      current: null,
      next: ALICE,
      actor: ALICE,
      expected: { action: "assign", requiresConfirmation: false, notify: [] },
    },
    {
      name: "AS-3: self pick-up of work held by someone else requires confirmation and notifies the previous holder (AS-18 excludes the actor, who is the new assignee)",
      current: ALICE,
      next: BOB,
      actor: BOB,
      expected: {
        action: "assign",
        requiresConfirmation: true,
        notify: [ALICE],
      },
    },
    {
      name: "reassign where the actor is the previous holder — not a self pick-up, so no confirmation; only the new assignee is notified",
      current: ALICE,
      next: BOB,
      actor: ALICE,
      expected: {
        action: "assign",
        requiresConfirmation: false,
        notify: [BOB],
      },
    },
    {
      name: "reassign by a third party — not a self pick-up (actor is neither holder), so no confirmation; both previous holder and new assignee are notified",
      current: ALICE,
      next: BOB,
      actor: CAROL,
      expected: {
        action: "assign",
        requiresConfirmation: false,
        notify: [ALICE, BOB],
      },
    },
    {
      name: "AS-17: unassign notifies the previous holder",
      current: ALICE,
      next: null,
      actor: BOB,
      expected: {
        action: "unassign",
        requiresConfirmation: false,
        notify: [ALICE],
      },
    },
    {
      name: "unassigning yourself never notifies you",
      current: ALICE,
      next: null,
      actor: ALICE,
      expected: {
        action: "unassign",
        requiresConfirmation: false,
        notify: [],
      },
    },
  ];

  it.each(cases)("$name", ({ current, next, actor, expected }) => {
    expect(planAssignment(current, next, actor)).toEqual(expected);
  });

  it("is deterministic", () => {
    expect(planAssignment(ALICE, BOB, CAROL)).toEqual(
      planAssignment(ALICE, BOB, CAROL),
    );
  });

  // Mutation check 4 (of the "at least three" required — see also the eligibility and
  // concurrency guards above, and resolveAssigneeDisplayStatus's below): flip
  // `requiresConfirmation`'s condition to drop the `newAssigneeId === actorId` (self
  // pick-up) test. A reassignment by someone who is neither holder must NOT require
  // confirmation — only a self pick-up does (AS-3).
  it("mutation guard: a fresh assign with no previous holder never requires confirmation", () => {
    expect(planAssignment(null, BOB, ALICE).requiresConfirmation).toBe(false);
  });

  it("mutation guard: a reassignment where the actor is not the new assignee never requires confirmation", () => {
    expect(planAssignment(ALICE, BOB, CAROL).requiresConfirmation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Display / retention — AS-7, AS-8, AS-9, and the edge cases table.
// ---------------------------------------------------------------------------

describe("resolveAssigneeDisplayStatus", () => {
  const active: AssigneeDisplayFacts = {
    active: true,
    onProject: true,
  };

  // Table-driven over the full 2×2 `active`/`onProject` matrix (four cases): exactly
  // three possible statuses exist now that AS-8 rules out a "former member"/tombstoned
  // fourth one ("People are never hard-deleted... 'Departed' means deactivated, never
  // gone").
  const cases: Array<{
    name: string;
    active: boolean;
    onProject: boolean;
    expected: ReturnType<typeof resolveAssigneeDisplayStatus>;
  }> = [
    {
      name: "active and on the project",
      active: true,
      onProject: true,
      expected: "active",
    },
    {
      name: "AS-8: inactive but still on the project — retained and shown inactive",
      active: false,
      onProject: true,
      expected: "inactive",
    },
    {
      name: "edge case: removed from the project (still active) — shown as no longer on this project",
      active: true,
      onProject: false,
      expected: "not_on_project",
    },
    {
      name: "precedence: removed from the project AND inactive — not_on_project wins",
      active: false,
      onProject: false,
      expected: "not_on_project",
    },
  ];

  it.each(cases)("$name", ({ active: isActive, onProject, expected }) => {
    expect(
      resolveAssigneeDisplayStatus(ALICE, { active: isActive, onProject }),
    ).toBe(expected);
  });

  it("no assignee at all", () => {
    expect(resolveAssigneeDisplayStatus(null, active)).toBeNull();
  });

  it("is deterministic", () => {
    expect(resolveAssigneeDisplayStatus(ALICE, active)).toBe(
      resolveAssigneeDisplayStatus(ALICE, active),
    );
  });

  // Mutation check 5: swap the precedence order (check `!active` before `!onProject`).
  // With this fact combination, the wrong order would return "inactive" instead of
  // "not_on_project".
  it("mutation guard: not_on_project must be checked before inactive", () => {
    const result = resolveAssigneeDisplayStatus(ALICE, {
      active: false,
      onProject: false,
    });
    expect(result).toBe("not_on_project");
  });
});
