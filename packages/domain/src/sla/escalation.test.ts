/**
 * SLA-17 / NO-22 escalation walk: order, waits, stood-down skipping, stop conditions.
 */

import { describe, expect, it } from "vitest";
import {
  advanceEscalation,
  type EscalationFacts,
  type EscalationStakeholder,
  escalationPath,
  escalationStopReason,
  startEscalation,
} from "./escalation.js";

const NOW = new Date("2026-10-23T10:00:00Z");

function stakeholder(
  personId: string,
  escalationOrder: number,
  escalationWaitMinutes: number,
  active = true,
): EscalationStakeholder {
  return { personId, escalationOrder, escalationWaitMinutes, active };
}

describe("escalationPath", () => {
  it("orders by escalationOrder and drops stood-down stakeholders", () => {
    const path = escalationPath([
      stakeholder("c", 3, 5),
      stakeholder("a", 1, 30),
      stakeholder("x", 2, 5, false),
      stakeholder("b", 2, 60),
    ]);
    expect(path.map((s) => s.personId)).toEqual(["a", "b", "c"]);
  });

  it("breaks an order tie by person id so replays are deterministic", () => {
    const path = escalationPath([
      stakeholder("z", 1, 0),
      stakeholder("m", 1, 0),
    ]);
    expect(path.map((s) => s.personId)).toEqual(["m", "z"]);
  });
});

describe("startEscalation (NO-22: notify the first immediately)", () => {
  it("is a no-op for a project with no stakeholders (SLA-17)", () => {
    expect(startEscalation([], NOW)).toBeNull();
  });

  it("is a no-op when every stakeholder is stood down", () => {
    expect(startEscalation([stakeholder("a", 1, 10, false)], NOW)).toBeNull();
  });

  it("notifies the first and schedules the next after the FIRST's wait", () => {
    const step = startEscalation(
      [stakeholder("b", 2, 99), stakeholder("a", 1, 30)],
      NOW,
    );
    expect(step?.notify[0]?.personId).toBe("a");
    expect(step?.nextDueAt).toEqual(new Date("2026-10-23T10:30:00Z"));
  });

  it("completes immediately when the only stakeholder is the first", () => {
    const step = startEscalation([stakeholder("a", 1, 30)], NOW);
    expect(step?.notify[0]?.personId).toBe("a");
    expect(step?.nextDueAt).toBeNull();
  });

  it("treats a zero wait as due right away", () => {
    const step = startEscalation(
      [stakeholder("a", 1, 0), stakeholder("b", 2, 0)],
      NOW,
    );
    expect(step?.nextDueAt).toEqual(NOW);
  });
});

describe("advanceEscalation", () => {
  const all = [
    stakeholder("a", 1, 30),
    stakeholder("b", 2, 45),
    stakeholder("c", 5, 10),
  ];

  it("returns the next stakeholder by order and uses its own wait for the one after", () => {
    const step = advanceEscalation(all, 1, NOW);
    expect(step?.notify[0]?.personId).toBe("b");
    expect(step?.nextDueAt).toEqual(new Date("2026-10-23T10:45:00Z"));
  });

  it("marks the last stakeholder complete", () => {
    const step = advanceEscalation(all, 2, NOW);
    expect(step?.notify[0]?.personId).toBe("c");
    expect(step?.nextDueAt).toBeNull();
  });

  it("is exhausted after the last order", () => {
    expect(advanceEscalation(all, 5, NOW)).toBeNull();
  });

  it("skips a stakeholder stood down mid-walk and follows reorders by order, not position", () => {
    const changed = [
      stakeholder("a", 1, 30),
      stakeholder("b", 2, 45, false),
      stakeholder("d", 3, 5),
      stakeholder("c", 5, 10),
    ];
    expect(advanceEscalation(changed, 1, NOW)?.notify[0]?.personId).toBe("d");
  });

  it("never re-notifies someone already passed when a new stakeholder is inserted earlier", () => {
    const changed = [stakeholder("n", 1, 5), ...all];
    // Walk already notified order 2; the late order-1 insert is not revisited.
    expect(advanceEscalation(changed, 2, NOW)?.notify[0]?.personId).toBe("c");
  });
});

describe("tied escalation orders (SLA-17)", () => {
  const tied = [
    stakeholder("z", 1, 10),
    stakeholder("m", 1, 30),
    stakeholder("x", 1, 5, false),
    stakeholder("q", 2, 15),
  ];

  it("starts by notifying every active stakeholder at the first order, waiting the longest wait", () => {
    const step = startEscalation(tied, NOW);
    expect(step?.order).toBe(1);
    expect(step?.notify.map((s) => s.personId)).toEqual(["m", "z"]);
    expect(step?.nextDueAt).toEqual(new Date("2026-10-23T10:30:00Z"));
  });

  it("advances by distinct order and notifies the tied group together", () => {
    const step = advanceEscalation(
      [
        stakeholder("a", 1, 5),
        stakeholder("b", 2, 20),
        stakeholder("c", 2, 40),
        stakeholder("d", 3, 1),
      ],
      1,
      NOW,
    );
    expect(step?.order).toBe(2);
    expect(step?.notify.map((s) => s.personId)).toEqual(["b", "c"]);
    expect(step?.nextDueAt).toEqual(new Date("2026-10-23T10:40:00Z"));
  });

  it("completes when the tied group is the last level", () => {
    const step = advanceEscalation(tied, 1, NOW);
    expect(step?.notify.map((s) => s.personId)).toEqual(["q"]);
    expect(step?.nextDueAt).toBeNull();
    const lastTie = advanceEscalation(
      [stakeholder("a", 1, 5), stakeholder("b", 2, 5), stakeholder("c", 2, 5)],
      1,
      NOW,
    );
    expect(lastTie?.notify).toHaveLength(2);
    expect(lastTie?.nextDueAt).toBeNull();
  });

  it("does not revisit an order already notified", () => {
    expect(advanceEscalation(tied, 2, NOW)).toBeNull();
  });
});

describe("escalationStopReason (NO-22)", () => {
  const base: EscalationFacts = {
    stillBreached: true,
    resolved: false,
    stateIdAtStart: "s1",
    currentStateId: "s1",
    assigneeIdAtStart: "p1",
    currentAssigneeId: "p1",
    staffCommentedSinceStart: false,
  };

  it("continues while the triggering condition holds and nobody intervened", () => {
    expect(escalationStopReason(base)).toBeNull();
  });

  it("stops on a state change", () => {
    expect(escalationStopReason({ ...base, currentStateId: "s2" })).toBe(
      "state_changed",
    );
  });

  it("stops on an assignment change, including assigned to unassigned", () => {
    expect(escalationStopReason({ ...base, currentAssigneeId: "p2" })).toBe(
      "assignment_changed",
    );
    expect(escalationStopReason({ ...base, currentAssigneeId: null })).toBe(
      "assignment_changed",
    );
    expect(
      escalationStopReason({
        ...base,
        assigneeIdAtStart: null,
        currentAssigneeId: "p2",
      }),
    ).toBe("assignment_changed");
  });

  it("stops on a staff comment", () => {
    expect(
      escalationStopReason({ ...base, staffCommentedSinceStart: true }),
    ).toBe("staff_commented");
  });

  it("stops when the metric is no longer breached, and reports resolution first", () => {
    expect(escalationStopReason({ ...base, stillBreached: false })).toBe(
      "no_longer_breached",
    );
    expect(
      escalationStopReason({ ...base, stillBreached: false, resolved: true }),
    ).toBe("resolved");
  });
});
