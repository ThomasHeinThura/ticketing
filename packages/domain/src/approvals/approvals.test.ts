/**
 * Approvals and CAB — tests (issue #36, `docs/03-features/approvals.md` § Testing).
 *
 * Named after the spec's own v1-defect tests where they are pure-logic checks:
 * `requester-cannot-self-approve` (`AP-8`) and `customer-cannot-request-cab` (`AP-2`).
 * The other two named E2E tests (`approver-email-not-leaked`) are a response-schema
 * concern, not this module's — nothing here ever carries an email address at all.
 *
 * All instants are explicit UTC `Date`s; no test reads a clock.
 */

import { describe, expect, it } from "vitest";
import {
  APPROVAL_EXPIRY_CAP_DAYS,
  applyApprovalAction,
  approvalsMatchingGate,
  decisionNoteSatisfies,
  dueReminder,
  evaluateApprovalDecision,
  evaluateApprovalWithdrawal,
  isApprovalOverdue,
  isCabMember,
  isGateSatisfied,
  isLegalApprovalAction,
  validateApprovalRequest,
} from "./approvals.js";
import type {
  Approval,
  ApprovalAction,
  ApprovalGate,
  ApprovalState,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "appr-1",
    transitionId: "transition-1",
    kind: "customer",
    requestedBy: "person-requester",
    approverId: "person-approver",
    state: "pending",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-08T00:00:00.000Z"),
    reminder50SentAt: null,
    reminder90SentAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Gate satisfaction — AP-5, AP-14, AP-15, AP-16, AP-18.
// ---------------------------------------------------------------------------

describe("isGateSatisfied", () => {
  it("any policy: satisfied by a single approved approval", () => {
    const gate: ApprovalGate = { transitionId: "t1", policy: "any" };
    const approvals = [approval({ transitionId: "t1", state: "approved" })];
    expect(isGateSatisfied(approvals, gate)).toBe(true);
  });

  it("any policy: not satisfied while pending", () => {
    const gate: ApprovalGate = { transitionId: "t1", policy: "any" };
    const approvals = [approval({ transitionId: "t1", state: "pending" })];
    expect(isGateSatisfied(approvals, gate)).toBe(false);
  });

  it("any policy: satisfied if at least one of several is approved", () => {
    const gate: ApprovalGate = { transitionId: "t1", policy: "any" };
    const approvals = [
      approval({ id: "a", transitionId: "t1", state: "rejected" }),
      approval({ id: "b", transitionId: "t1", state: "approved" }),
      approval({ id: "c", transitionId: "t1", state: "pending" }),
    ];
    expect(isGateSatisfied(approvals, gate)).toBe(true);
  });

  it("all policy: satisfied only when every matching approval is approved", () => {
    const gate: ApprovalGate = { transitionId: "t1", policy: "all" };
    const allApproved = [
      approval({ id: "a", transitionId: "t1", state: "approved" }),
      approval({ id: "b", transitionId: "t1", state: "approved" }),
    ];
    expect(isGateSatisfied(allApproved, gate)).toBe(true);
  });

  it("all policy, one rejected: gate stays blocked (AP-18)", () => {
    const gate: ApprovalGate = { transitionId: "t1", policy: "all" };
    const oneRejected = [
      approval({ id: "a", transitionId: "t1", state: "approved" }),
      approval({ id: "b", transitionId: "t1", state: "rejected" }),
    ];
    expect(isGateSatisfied(oneRejected, gate)).toBe(false);
  });

  it("all policy, one still pending: gate stays blocked", () => {
    const gate: ApprovalGate = { transitionId: "t1", policy: "all" };
    const onePending = [
      approval({ id: "a", transitionId: "t1", state: "approved" }),
      approval({ id: "b", transitionId: "t1", state: "pending" }),
    ];
    expect(isGateSatisfied(onePending, gate)).toBe(false);
  });

  it("no matching approvals at all: never satisfied, any or all", () => {
    const anyGate: ApprovalGate = { transitionId: "t1", policy: "any" };
    const allGate: ApprovalGate = { transitionId: "t1", policy: "all" };
    expect(isGateSatisfied([], anyGate)).toBe(false);
    expect(isGateSatisfied([], allGate)).toBe(false);
  });

  it("AP-14: an expired approval does not satisfy a gate", () => {
    const gate: ApprovalGate = { transitionId: "t1", policy: "any" };
    const approvals = [approval({ transitionId: "t1", state: "expired" })];
    expect(isGateSatisfied(approvals, gate)).toBe(false);
  });

  it("AP-16: a requires_cab gate only counts kind = cab approvals", () => {
    const gate: ApprovalGate = {
      transitionId: "t1",
      policy: "any",
      kind: "cab",
    };
    const customerApproved = [
      approval({ transitionId: "t1", kind: "customer", state: "approved" }),
    ];
    const cabApproved = [
      approval({ transitionId: "t1", kind: "cab", state: "approved" }),
    ];
    expect(isGateSatisfied(customerApproved, gate)).toBe(false);
    expect(isGateSatisfied(cabApproved, gate)).toBe(true);
  });

  it(
    "AP-5 named test: two concurrent approvals of the same kind, raised against " +
      "different transitions, where only the one matching transitionId satisfies its own gate",
    () => {
      const approvals = [
        approval({
          id: "a",
          kind: "cab",
          transitionId: "transition-A",
          state: "approved",
        }),
        approval({
          id: "b",
          kind: "cab",
          transitionId: "transition-B",
          state: "approved",
        }),
      ];
      const gateA: ApprovalGate = {
        transitionId: "transition-A",
        policy: "any",
        kind: "cab",
      };
      const gateB: ApprovalGate = {
        transitionId: "transition-B",
        policy: "any",
        kind: "cab",
      };
      expect(approvalsMatchingGate(approvals, gateA)).toEqual([approvals[0]]);
      expect(approvalsMatchingGate(approvals, gateB)).toEqual([approvals[1]]);
      expect(isGateSatisfied(approvals, gateA)).toBe(true);
      expect(isGateSatisfied(approvals, gateB)).toBe(true);

      // And a gate for a transition neither approval was raised against is unsatisfied,
      // even though both approvals are approved and of the matching kind.
      const gateC: ApprovalGate = {
        transitionId: "transition-C",
        policy: "any",
        kind: "cab",
      };
      expect(isGateSatisfied(approvals, gateC)).toBe(false);
    },
  );

  it(
    "edge case: gating transition changed in a new workflow version — an approval " +
      "raised against the old transition id never satisfies the new one",
    () => {
      const approvedAgainstOldTransition = [
        approval({ transitionId: "transition-v1", state: "approved" }),
      ];
      const newVersionGate: ApprovalGate = {
        transitionId: "transition-v2",
        policy: "any",
      };
      expect(
        isGateSatisfied(approvedAgainstOldTransition, newVersionGate),
      ).toBe(false);
      // The approval is not force-closed by this — it is simply excluded, and its own
      // state is untouched (nothing here mutates `approval.state`).
      expect(approvedAgainstOldTransition[0]?.state).toBe("approved");
    },
  );
});

// ---------------------------------------------------------------------------
// Requesting — AP-1, AP-2, AP-4, AP-8 (request-time), edge cases.
// ---------------------------------------------------------------------------

describe("validateApprovalRequest", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      kind: "customer" as const,
      requestedBy: "requester",
      approverId: "approver",
      expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      now,
      isRequesterStaff: true,
      isChangeType: false,
      ...overrides,
    };
  }

  it("accepts a well-formed customer request", () => {
    expect(validateApprovalRequest(baseInput())).toEqual({ ok: true });
  });

  it("AP-1: a non-staff requester is refused for kind = customer", () => {
    const result = validateApprovalRequest(
      baseInput({ isRequesterStaff: false }),
    );
    expect(result).toEqual({ ok: false, reasons: ["requester_not_staff"] });
  });

  it("AP-1: a staff requester is accepted for kind = customer", () => {
    const result = validateApprovalRequest(
      baseInput({ isRequesterStaff: true }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("AP-2: a non-staff requester is refused for kind = cab (customer-cannot-request-cab)", () => {
    const result = validateApprovalRequest(
      baseInput({ kind: "cab", isRequesterStaff: false, isChangeType: true }),
    );
    expect(result).toEqual({ ok: false, reasons: ["cab_requires_staff"] });
  });

  it("AP-2: a staff requester is accepted for kind = cab (given is_change)", () => {
    const result = validateApprovalRequest(
      baseInput({ kind: "cab", isRequesterStaff: true, isChangeType: true }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("requester-cannot-self-approve: refused at request time (edge case 422)", () => {
    const result = validateApprovalRequest(
      baseInput({ approverId: "requester" }),
    );
    expect(result).toEqual({ ok: false, reasons: ["self_approval"] });
  });

  it("AP-2: a CAB request on a non-change work item type is refused even for staff", () => {
    const result = validateApprovalRequest(
      baseInput({ kind: "cab", isRequesterStaff: true, isChangeType: false }),
    );
    expect(result).toEqual({
      ok: false,
      reasons: ["cab_requires_change_type"],
    });
  });

  it("a CAB request failing both staff and change-type reports both reasons", () => {
    const result = validateApprovalRequest(
      baseInput({ kind: "cab", isRequesterStaff: false, isChangeType: false }),
    );
    expect(result).toEqual({
      ok: false,
      reasons: ["cab_requires_staff", "cab_requires_change_type"],
    });
  });

  it("a staff CAB request on a change item is accepted", () => {
    const result = validateApprovalRequest(
      baseInput({ kind: "cab", isRequesterStaff: true, isChangeType: true }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("edge case: expiry set in the past is refused (422)", () => {
    const result = validateApprovalRequest(
      baseInput({ expiresAt: new Date(now.getTime() - DAY_MS) }),
    );
    expect(result).toEqual({ ok: false, reasons: ["expiry_not_in_future"] });
  });

  it("expiry set to exactly now is refused (not in the future)", () => {
    const result = validateApprovalRequest(baseInput({ expiresAt: now }));
    expect(result).toEqual({ ok: false, reasons: ["expiry_not_in_future"] });
  });

  it(`AP-4: expiry at exactly the ${APPROVAL_EXPIRY_CAP_DAYS}-day cap is accepted`, () => {
    const result = validateApprovalRequest(
      baseInput({
        expiresAt: new Date(now.getTime() + APPROVAL_EXPIRY_CAP_DAYS * DAY_MS),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("AP-4: expiry one millisecond past the 90-day cap is refused", () => {
    const result = validateApprovalRequest(
      baseInput({
        expiresAt: new Date(
          now.getTime() + APPROVAL_EXPIRY_CAP_DAYS * DAY_MS + 1,
        ),
      }),
    );
    expect(result).toEqual({ ok: false, reasons: ["expiry_exceeds_cap"] });
  });

  it("reports every applicable reason at once, not only the first", () => {
    const result = validateApprovalRequest(
      baseInput({
        approverId: "requester",
        kind: "cab",
        isRequesterStaff: false,
        isChangeType: false,
        expiresAt: new Date(now.getTime() - DAY_MS),
      }),
    );
    expect(result).toEqual({
      ok: false,
      reasons: [
        "self_approval",
        "cab_requires_staff",
        "cab_requires_change_type",
        "expiry_not_in_future",
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// CAB membership — AP-16.
// ---------------------------------------------------------------------------

describe("isCabMember", () => {
  it("true when the person is in the supplied membership set", () => {
    expect(isCabMember("p1", new Set(["p1", "p2"]))).toBe(true);
  });

  it("false when the person is not in the supplied membership set", () => {
    expect(isCabMember("p3", new Set(["p1", "p2"]))).toBe(false);
  });

  it("false for an empty membership set", () => {
    expect(isCabMember("p1", new Set())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deciding — AP-7, AP-8, AP-9, AP-16.
// ---------------------------------------------------------------------------

describe("decisionNoteSatisfies", () => {
  it("AP-9: approving is noteless", () => {
    expect(decisionNoteSatisfies("approve", null)).toBe(true);
    expect(decisionNoteSatisfies("approve", "")).toBe(true);
  });

  it("AP-9: rejecting requires a non-empty note", () => {
    expect(decisionNoteSatisfies("reject", null)).toBe(false);
    expect(decisionNoteSatisfies("reject", "")).toBe(false);
    expect(decisionNoteSatisfies("reject", "   ")).toBe(false);
    expect(decisionNoteSatisfies("reject", "not today")).toBe(true);
  });
});

describe("evaluateApprovalDecision", () => {
  it("accepts a legal approve by the named approver", () => {
    const result = evaluateApprovalDecision({
      approval: approval(),
      actingPersonId: "person-approver",
      action: "approve",
      note: null,
    });
    expect(result).toEqual({ ok: true, nextState: "approved" });
  });

  it("accepts a legal reject with a note", () => {
    const result = evaluateApprovalDecision({
      approval: approval(),
      actingPersonId: "person-approver",
      action: "reject",
      note: "not acceptable",
    });
    expect(result).toEqual({ ok: true, nextState: "rejected" });
  });

  it("requester-cannot-self-approve: refused even when named as the approver", () => {
    const selfApproval = approval({
      requestedBy: "person-x",
      approverId: "person-x",
    });
    const result = evaluateApprovalDecision({
      approval: selfApproval,
      actingPersonId: "person-x",
      action: "approve",
      note: null,
    });
    expect(result).toEqual({ ok: false, reasons: ["self_approval"] });
  });

  it("AP-7: only the named approver may decide — not a manager, not an admin", () => {
    const result = evaluateApprovalDecision({
      approval: approval(),
      actingPersonId: "someone-else",
      action: "approve",
      note: null,
    });
    expect(result).toEqual({ ok: false, reasons: ["not_named_approver"] });
  });

  it("AP-9: rejecting without a note is refused", () => {
    const result = evaluateApprovalDecision({
      approval: approval(),
      actingPersonId: "person-approver",
      action: "reject",
      note: null,
    });
    expect(result).toEqual({ ok: false, reasons: ["note_required"] });
  });

  it("AP-10/AP-14: a non-pending approval cannot be decided again", () => {
    const result = evaluateApprovalDecision({
      approval: approval({ state: "approved" }),
      actingPersonId: "person-approver",
      action: "approve",
      note: null,
    });
    expect(result).toEqual({ ok: false, reasons: ["not_pending"] });
  });

  it("AP-16: a CAB approval requires the acting person to be a CAB member", () => {
    const cabApproval = approval({ kind: "cab" });
    const notMember = evaluateApprovalDecision({
      approval: cabApproval,
      actingPersonId: "person-approver",
      action: "approve",
      note: null,
      cabMemberIds: new Set(["someone-else"]),
    });
    expect(notMember).toEqual({ ok: false, reasons: ["not_cab_member"] });

    const isMember = evaluateApprovalDecision({
      approval: cabApproval,
      actingPersonId: "person-approver",
      action: "approve",
      note: null,
      cabMemberIds: new Set(["person-approver"]),
    });
    expect(isMember).toEqual({ ok: true, nextState: "approved" });
  });

  it("AP-16: an omitted CAB membership set fails closed, never assumes membership", () => {
    const cabApproval = approval({ kind: "cab" });
    const result = evaluateApprovalDecision({
      approval: cabApproval,
      actingPersonId: "person-approver",
      action: "approve",
      note: null,
    });
    expect(result).toEqual({ ok: false, reasons: ["not_cab_member"] });
  });

  it("a customer-kind approval is unaffected by cabMemberIds", () => {
    const result = evaluateApprovalDecision({
      approval: approval({ kind: "customer" }),
      actingPersonId: "person-approver",
      action: "approve",
      note: null,
      cabMemberIds: new Set(),
    });
    expect(result).toEqual({ ok: true, nextState: "approved" });
  });

  it("reports every applicable reason at once", () => {
    const cabApproval = approval({
      kind: "cab",
      requestedBy: "outsider",
      approverId: "outsider",
      state: "rejected",
    });
    const result = evaluateApprovalDecision({
      approval: cabApproval,
      actingPersonId: "outsider",
      action: "reject",
      note: null,
      cabMemberIds: new Set(),
    });
    expect(result).toEqual({
      ok: false,
      reasons: [
        "not_pending",
        "self_approval",
        "not_cab_member",
        "note_required",
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Withdrawing — AP-6, Permissions.
// ---------------------------------------------------------------------------

describe("evaluateApprovalWithdrawal", () => {
  it("the requester may withdraw a pending approval", () => {
    const result = evaluateApprovalWithdrawal({
      approval: approval({ requestedBy: "requester" }),
      actingPersonId: "requester",
      isInstanceAdmin: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("an instance admin may withdraw on the requester's behalf", () => {
    const result = evaluateApprovalWithdrawal({
      approval: approval({ requestedBy: "requester" }),
      actingPersonId: "admin",
      isInstanceAdmin: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it("neither the requester nor an admin: refused", () => {
    const result = evaluateApprovalWithdrawal({
      approval: approval({ requestedBy: "requester" }),
      actingPersonId: "bystander",
      isInstanceAdmin: false,
    });
    expect(result).toEqual({ ok: false, reasons: ["not_permitted"] });
  });

  it("a non-pending approval cannot be withdrawn", () => {
    const result = evaluateApprovalWithdrawal({
      approval: approval({ requestedBy: "requester", state: "approved" }),
      actingPersonId: "requester",
      isInstanceAdmin: false,
    });
    expect(result).toEqual({ ok: false, reasons: ["not_pending"] });
  });

  it("reports both reasons when neither permitted nor pending", () => {
    const result = evaluateApprovalWithdrawal({
      approval: approval({ requestedBy: "requester", state: "withdrawn" }),
      actingPersonId: "bystander",
      isInstanceAdmin: false,
    });
    expect(result).toEqual({
      ok: false,
      reasons: ["not_pending", "not_permitted"],
    });
  });
});

// ---------------------------------------------------------------------------
// State transitions — AP-6, AP-9, AP-10, AP-12. Exhaustive state × action matrix.
// ---------------------------------------------------------------------------

describe("isLegalApprovalAction / applyApprovalAction", () => {
  const states: ApprovalState[] = [
    "pending",
    "approved",
    "rejected",
    "expired",
    "withdrawn",
  ];
  const actions: ApprovalAction[] = ["approve", "reject", "withdraw", "expire"];

  const expectedNextState: Record<ApprovalAction, ApprovalState> = {
    approve: "approved",
    reject: "rejected",
    withdraw: "withdrawn",
    expire: "expired",
  };

  for (const state of states) {
    for (const action of actions) {
      const shouldBeLegal = state === "pending";
      it(`${state} × ${action} → ${
        shouldBeLegal ? expectedNextState[action] : "refused"
      }`, () => {
        expect(isLegalApprovalAction(state, action)).toBe(shouldBeLegal);
        expect(applyApprovalAction(state, action)).toBe(
          shouldBeLegal ? expectedNextState[action] : null,
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Expiry and reminders — AP-12, AP-13.
// ---------------------------------------------------------------------------

describe("isApprovalOverdue", () => {
  const created = new Date("2026-01-01T00:00:00.000Z");
  const expires = new Date("2026-01-08T00:00:00.000Z");

  it("not overdue before expiresAt", () => {
    const a = approval({ createdAt: created, expiresAt: expires });
    expect(isApprovalOverdue(a, new Date("2026-01-07T00:00:00.000Z"))).toBe(
      false,
    );
  });

  it("overdue exactly at expiresAt", () => {
    const a = approval({ createdAt: created, expiresAt: expires });
    expect(isApprovalOverdue(a, expires)).toBe(true);
  });

  it("overdue after expiresAt", () => {
    const a = approval({ createdAt: created, expiresAt: expires });
    expect(isApprovalOverdue(a, new Date("2026-01-09T00:00:00.000Z"))).toBe(
      true,
    );
  });

  it("a non-pending approval is never reported overdue", () => {
    const a = approval({
      createdAt: created,
      expiresAt: expires,
      state: "approved",
    });
    expect(isApprovalOverdue(a, new Date("2026-02-01T00:00:00.000Z"))).toBe(
      false,
    );
  });
});

describe("dueReminder", () => {
  const created = new Date("2026-01-01T00:00:00.000Z");
  const expires = new Date("2026-01-08T00:00:00.000Z"); // 7-day window
  const windowMs = expires.getTime() - created.getTime();

  function at(pct: number): Date {
    return new Date(created.getTime() + windowMs * pct);
  }

  it("no reminder due before 50%", () => {
    const a = approval({ createdAt: created, expiresAt: expires });
    expect(dueReminder(a, at(0.49))).toBeNull();
  });

  it("50% reminder due at exactly 50%, when not yet sent", () => {
    const a = approval({ createdAt: created, expiresAt: expires });
    expect(dueReminder(a, at(0.5))).toBe("reminder_50");
  });

  it("idempotent: no reminder re-sent once reminder_50_sent_at is set", () => {
    const a = approval({
      createdAt: created,
      expiresAt: expires,
      reminder50SentAt: at(0.5),
    });
    // Still within the 50-90% band — nothing else is due yet.
    expect(dueReminder(a, at(0.6))).toBeNull();
  });

  it("90% reminder due at exactly 90%, when 50% already sent and 90% not yet", () => {
    const a = approval({
      createdAt: created,
      expiresAt: expires,
      reminder50SentAt: at(0.5),
    });
    expect(dueReminder(a, at(0.9))).toBe("reminder_90");
  });

  it("idempotent: no reminder re-sent once both have fired", () => {
    const a = approval({
      createdAt: created,
      expiresAt: expires,
      reminder50SentAt: at(0.5),
      reminder90SentAt: at(0.9),
    });
    expect(dueReminder(a, at(1.5))).toBeNull();
  });

  it("reports the lower threshold first when a scan is delayed past both", () => {
    const a = approval({ createdAt: created, expiresAt: expires });
    // Neither reminder has fired, and we are already past 90% — 50% is still reported
    // first; the caller re-scans afterward to pick up 90%.
    expect(dueReminder(a, at(0.95))).toBe("reminder_50");
  });

  it("once 50% is marked sent, a later call at the same instant returns 90%", () => {
    const a = approval({
      createdAt: created,
      expiresAt: expires,
      reminder50SentAt: at(0.95),
    });
    expect(dueReminder(a, at(0.95))).toBe("reminder_90");
  });

  it("no reminder for a non-pending approval, however far past the window", () => {
    const a = approval({
      createdAt: created,
      expiresAt: expires,
      state: "expired",
    });
    expect(dueReminder(a, at(2))).toBeNull();
  });

  it("a malformed window (expiresAt at or before createdAt) never reports a reminder due", () => {
    const a = approval({ createdAt: expires, expiresAt: created });
    expect(dueReminder(a, new Date("2026-06-01T00:00:00.000Z"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mutation checks — flip a rule, confirm its test fails, then restore (task instruction).
// These are recorded as comments describing what was verified by hand, not left in the
// suite as always-passing assertions; see the pull request body for the three rules
// checked and their exact flips.
// ---------------------------------------------------------------------------
