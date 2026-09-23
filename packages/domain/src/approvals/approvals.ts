/**
 * Approvals and CAB — pure functions, no I/O, no ambient clock (issue #36).
 *
 * Every function here takes an `Approval` (or a list of them) and every fact it needs as
 * plain arguments. None of them load an `approval` row, query CAB team membership, check
 * a capability, write `decided_at`/`decision_note`, emit `approval.decided`/
 * `approval.withdrawn`, write an activity entry, or send a notification — those are the
 * impure edge (`apps/api`), per `docs/03-features/approvals.md` and this package's own
 * `../workflow/workflow.ts`, whose split between "decide legality" and "execute the
 * effect" this module deliberately mirrors.
 *
 * **What is deliberately left out, because the spec is silent on the pure-function shape
 * (do-not 17 — never guess):**
 * - "Approver leaves the organisation" / "Approver loses reach" (edge cases): the spec
 *   says these get *flagged*, not that the domain computes anything about it — there is no
 *   named rule or column for "flagged" on `approval` in `data-model.md` §7. Left out.
 * - Soft-delete visibility ("Work item soft-deleted with a pending approval" — hidden,
 *   reappears with the work item, purged after 30 days): this is a query/visibility
 *   concern at the impure edge (which rows a `SELECT` returns), not a decision this module
 *   makes over an `Approval` it has already been handed. Left out.
 * - `AP-17`'s human-readable blocked-transition message ("Waiting on approval from Jane
 *   Smith, requested 2 days ago, expires in 5 days"): free text naming a person, not a
 *   stable code this module can decide — mirrors `../workflow/`'s own `BlockReason`, which
 *   carries `reasonCode`, never a message, for the same reason.
 */

import type {
  Approval,
  ApprovalAction,
  ApprovalDecisionInput,
  ApprovalDecisionRefusalReason,
  ApprovalGate,
  ApprovalRequestInput,
  ApprovalRequestRefusalReason,
  ApprovalState,
  ApprovalWithdrawalInput,
  ApprovalWithdrawalRefusalReason,
  ReminderKind,
} from "./types.js";

// ---------------------------------------------------------------------------
// Gate satisfaction — AP-5, AP-14, AP-15, AP-16, AP-18.
// ---------------------------------------------------------------------------

/**
 * Every approval in `approvals` that counts toward `gate` — `AP-5`'s "Only approvals
 * whose `transition_id` names *that* transition count toward it; an approval raised
 * against a different transition, even the same `kind`, on the same work item never
 * satisfies this gate." Exported on its own (not only folded into `isGateSatisfied`)
 * because a caller building `AP-17`'s "who is this waiting on" message needs the matching
 * set itself, not only a boolean.
 *
 * This is also, unchanged, the answer to the workflow-version-change edge case
 * (`approvals.md` § Edge cases): a new workflow version's transition has a different
 * `id`, so an approval raised against the old transition's id never matches `gate`'s new
 * `transitionId` here — it is excluded, exactly as if it did not exist, without this
 * function (or any caller) needing to know a version ever changed.
 */
export function approvalsMatchingGate(
  approvals: readonly Approval[],
  gate: ApprovalGate,
): Approval[] {
  return approvals.filter(
    (a) =>
      a.transitionId === gate.transitionId &&
      (gate.kind === undefined || a.kind === gate.kind),
  );
}

/**
 * Whether `gate` is satisfied by `approvals` (`AP-5`, `AP-15`, `AP-16`). `AP-14`: an
 * `expired` approval is not `approved`, so it never counts — no special case is needed
 * beyond checking `state === "approved"`. `AP-18`: an "all" gate with one rejection stays
 * blocked — `every` fails the instant one matching approval is not `approved`, rejected or
 * still `pending` alike. A gate with no matching approvals at all is never satisfied,
 * "any" or "all" — there is nothing to be satisfied *by*.
 */
export function isGateSatisfied(
  approvals: readonly Approval[],
  gate: ApprovalGate,
): boolean {
  const matching = approvalsMatchingGate(approvals, gate);
  if (matching.length === 0) {
    return false;
  }
  return gate.policy === "any"
    ? matching.some((a) => a.state === "approved")
    : matching.every((a) => a.state === "approved");
}

// ---------------------------------------------------------------------------
// Requesting — AP-1, AP-2, AP-4, AP-8 (request-time half), and the two 422 edge cases.
// ---------------------------------------------------------------------------

/** `AP-4`'s fixed cap: a request may override the instance default, never past this many days. The default itself (`instance_setting.approval_default_expiry_days`) is instance-configurable; this cap is not. */
export const APPROVAL_EXPIRY_CAP_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Refuses a new approval request independent of capabilities, mirroring `AP-8`'s own
 * "enforced in the domain layer, independent of capabilities" for the decision-time half.
 * Collects every applicable reason rather than stopping at the first, the same style
 * `../workflow/workflow.ts`'s `validateWorkflowVersion` uses for its `errors` list — a
 * request can be simultaneously self-approval and past-cap, and a caller building a 422
 * body wants all of it, not just whichever check ran first.
 *
 * - **Self-approval at request time** (edge case: "Approver is also the requester —
 *   Rejected at 422 with a clear message"). This is the same rule `AP-8` states for
 *   *deciding*, applied at the moment the pairing is created — refusing it here is what
 *   makes the case in `evaluateApprovalDecision` below structurally unreachable through
 *   this module's own request path, not merely tested for.
 * - **`AP-1`**: "A customer approval may be requested **by staff** with `approval:request`"
 *   (`approvals.md:45`), also the Permissions table's own "Request a customer approval |
 *   `approval:request` | **Staff only**" (`approvals.md:117`). Checked here independent of
 *   the `approval:request` capability, the same defense-in-depth stance `AP-8` takes for
 *   self-approval — a capability grant is not this module's business to trust blindly.
 * - **`AP-2`**: a CAB approval requires staff standing (the same staff-only rule `AP-1`
 *   states for a customer approval, restated for CAB in the Permissions table's "Request a
 *   CAB approval | `approval:request_cab` | Staff only, ...") and `work_item_type.is_change`.
 *   Both — plus the shared staff check above — are independently reported when they fail:
 *   the v1 defect this closes ("a customer-side account could request an internal CAB
 *   approval") was a single missing check, not several, but nothing says a customer
 *   account can't also target a non-change item, and the caller should see all of it.
 * - **Expiry**: "Expiry set in the past" (`expiresAt <= now`, strictly — an approval that
 *   expires the instant it is created satisfies no gate and reminds nobody, so it is
 *   treated the same as already in the past) and `AP-4`'s 90-day cap.
 */
export function validateApprovalRequest(
  input: ApprovalRequestInput,
): { ok: true } | { ok: false; reasons: ApprovalRequestRefusalReason[] } {
  const reasons: ApprovalRequestRefusalReason[] = [];

  if (input.requestedBy === input.approverId) {
    reasons.push("self_approval");
  }

  if (!input.isRequesterStaff) {
    // AP-1's "Staff only" applies to a customer approval exactly as AP-2's does to a CAB
    // one; the reason code still distinguishes which rule fired, since a customer-kind
    // refusal and a CAB-kind refusal are different messages at the caller's 422 body.
    reasons.push(
      input.kind === "cab" ? "cab_requires_staff" : "requester_not_staff",
    );
  }

  if (input.kind === "cab" && !input.isChangeType) {
    reasons.push("cab_requires_change_type");
  }

  if (input.expiresAt.getTime() <= input.now.getTime()) {
    reasons.push("expiry_not_in_future");
  } else {
    const capMs = input.now.getTime() + APPROVAL_EXPIRY_CAP_DAYS * MS_PER_DAY;
    if (input.expiresAt.getTime() > capMs) {
      reasons.push("expiry_exceeds_cap");
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// ---------------------------------------------------------------------------
// CAB membership — Permissions § "Decide a CAB approval" (approvals.md:118 — "Must also be
// a team_member of the team flagged is_cab ... capability and membership are both
// required, not either alone"). Not AP-16, which is the gate's own kind-matching rule
// (a requires_cab gate only counts kind = 'cab' approvals) — see ApprovalGate.kind above.
// ---------------------------------------------------------------------------

/**
 * Whether `personId` is a member of the CAB team, given the caller-supplied membership
 * set — never looked up here (the task's own instruction: "supplied as a membership
 * predicate/set, not looked up"; `team.is_cab` + `team_member` resolution is the impure
 * edge's job, per `data-model.md` and `approvals.md` § Permissions).
 */
export function isCabMember(
  personId: string,
  cabMemberIds: ReadonlySet<string>,
): boolean {
  return cabMemberIds.has(personId);
}

// ---------------------------------------------------------------------------
// Deciding — AP-7, AP-8, AP-9, and Permissions § "Decide a CAB approval" (CAB membership).
// ---------------------------------------------------------------------------

/**
 * Whether a note satisfies `action`'s note policy (`AP-9`: "A decision requires a note
 * when rejecting. Approving may be noteless."). A whitespace-only note does not count —
 * the same "present" test `../workflow/workflow.ts`'s `isFieldPresent` uses for a
 * `field_required` guard, applied here to the one field this module itself validates.
 */
export function decisionNoteSatisfies(
  action: "approve" | "reject",
  note: string | null,
): boolean {
  if (action === "approve") {
    return true;
  }
  return note !== null && note.trim().length > 0;
}

/**
 * Refuses or accepts a decision attempt, whatever capabilities the acting person holds
 * (`AP-8`: "Enforced in the domain layer, independent of capabilities"). Every applicable
 * reason is reported, not only the first — a request from someone who is neither the
 * named approver nor a CAB member, rejecting without a note, is three defects at once.
 *
 * - **`AP-7`**: only `approval.approverId` may decide — "Not their manager, not an
 *   admin." An instance admin's *withdraw* path is a different function
 *   (`evaluateApprovalWithdrawal`, below), deliberately: `AP-7`'s admin exception is
 *   scoped to withdrawing, never to deciding.
 * - **`AP-8`**: nobody decides a request they raised. Checked here independent of, and in
 *   addition to, `validateApprovalRequest`'s own request-time check — this module does
 *   not assume its own request-time gate was actually run by every caller (a row can also
 *   arrive from a fixture, a migration backfill, or a future write path this module has
 *   no visibility into), so the decision-time check stands on its own, exactly as `AP-8`'s
 *   own wording ("Nobody may approve a request they raised") states it as a rule about
 *   deciding, not only about requesting.
 * - **Permissions § "Decide a CAB approval"** (`approvals.md:118`): a `kind: "cab"`
 *   approval additionally requires CAB membership — not `AP-16`, which is the gate's own
 *   kind-matching rule (see `ApprovalGate.kind`'s doc comment). `cabMemberIds` must be
 *   supplied for a CAB approval; an omitted set is treated as "not a member" (fail closed —
 *   never assume membership when the caller did not resolve it).
 * - **State**: only `pending` may be decided (`AP-10`: "A decision is final"; `AP-14`: an
 *   expired approval cannot be approved after the fact).
 */
export function evaluateApprovalDecision(input: ApprovalDecisionInput):
  | { ok: true; nextState: "approved" | "rejected" }
  | {
      ok: false;
      reasons: ApprovalDecisionRefusalReason[];
    } {
  const { approval, actingPersonId, action, note } = input;
  const reasons: ApprovalDecisionRefusalReason[] = [];

  if (approval.state !== "pending") {
    reasons.push("not_pending");
  }
  if (approval.approverId !== actingPersonId) {
    reasons.push("not_named_approver");
  }
  if (approval.requestedBy === actingPersonId) {
    reasons.push("self_approval");
  }
  if (approval.kind === "cab") {
    const cabMemberIds = input.cabMemberIds ?? new Set<string>();
    if (!isCabMember(actingPersonId, cabMemberIds)) {
      reasons.push("not_cab_member");
    }
  }
  if (!decisionNoteSatisfies(action, note)) {
    reasons.push("note_required");
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return {
    ok: true,
    nextState: action === "approve" ? "approved" : "rejected",
  };
}

// ---------------------------------------------------------------------------
// Withdrawing — AP-6, Permissions ("Withdraw").
// ---------------------------------------------------------------------------

/**
 * Refuses or accepts a withdrawal (`AP-6`: "The requester may withdraw a pending
 * approval," and, per § Permissions, "Requester, or instance admin (audited)"). Only
 * `pending` may be withdrawn — `AP-10`'s finality applies here too, and matches
 * `isLegalApprovalAction("withdraw")`'s own restriction to `pending`, below. The audit
 * write itself (`AP-6`: "audited" for the admin path) is the impure edge's job; this
 * function only decides whether the attempt is legal.
 */
export function evaluateApprovalWithdrawal(
  input: ApprovalWithdrawalInput,
): { ok: true } | { ok: false; reasons: ApprovalWithdrawalRefusalReason[] } {
  const { approval, actingPersonId, isInstanceAdmin } = input;
  const reasons: ApprovalWithdrawalRefusalReason[] = [];

  if (approval.state !== "pending") {
    reasons.push("not_pending");
  }
  if (approval.requestedBy !== actingPersonId && !isInstanceAdmin) {
    reasons.push("not_permitted");
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// ---------------------------------------------------------------------------
// State transitions — AP-6, AP-7/AP-9 (decide), AP-10, AP-12. A legal-transition matrix,
// exactly the shape `../workflow/workflow.ts` uses for a work item's own state.
// ---------------------------------------------------------------------------

const LEGAL_ACTIONS_BY_STATE: Readonly<
  Record<ApprovalState, ReadonlySet<ApprovalAction>>
> = {
  pending: new Set<ApprovalAction>(["approve", "reject", "withdraw", "expire"]),
  approved: new Set(),
  rejected: new Set(),
  expired: new Set(),
  withdrawn: new Set(),
};

/**
 * Whether `action` may be applied to an approval currently in `state` (`AP-10`: "A
 * decision is final. Changing your mind means a new approval request" — and the same
 * finality applies to every terminal state, not only a decided one). Only `pending` ever
 * accepts an action; every other state refuses all four, which is what makes `approved`,
 * `rejected`, `expired` and `withdrawn` genuinely terminal rather than terminal by
 * convention only.
 */
export function isLegalApprovalAction(
  state: ApprovalState,
  action: ApprovalAction,
): boolean {
  return LEGAL_ACTIONS_BY_STATE[state].has(action);
}

/**
 * The state `action` produces from `state`, or `null` if illegal (`isLegalApprovalAction`
 * says which). Never throws — mirrors `../workflow/workflow.ts`'s `findLegalTransition`
 * returning `undefined` rather than throwing: the caller (which knows whether to answer
 * 409 or 422) decides what an illegal action means for its own response, this function
 * only decides legality and, if legal, the result.
 */
export function applyApprovalAction(
  state: ApprovalState,
  action: ApprovalAction,
): ApprovalState | null {
  if (!isLegalApprovalAction(state, action)) {
    return null;
  }
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "withdraw":
      return "withdrawn";
    case "expire":
      return "expired";
  }
}

// ---------------------------------------------------------------------------
// Expiry and reminders — AP-12, AP-13.
// ---------------------------------------------------------------------------

/**
 * Whether `approval` has passed its `expiresAt` at `now` (`AP-12`: "`reminder-scan`
 * expires approvals past `expires_at`, setting status `expired`"). Only `pending`
 * approvals can expire — an already-decided or withdrawn approval is terminal
 * (`isLegalApprovalAction`), so this checks state itself rather than assuming the caller
 * pre-filtered to `pending`.
 */
export function isApprovalOverdue(approval: Approval, now: Date): boolean {
  return (
    approval.state === "pending" &&
    now.getTime() >= approval.expiresAt.getTime()
  );
}

/**
 * Which reminder (if either) is due right now, given `approval`'s window and which
 * reminders have already fired (`AP-13`). Idempotent by construction: once
 * `reminder50SentAt`/`reminder90SentAt` is non-null, that threshold can never be reported
 * due again, however many times `reminder-scan` calls this on the same row — this is the
 * concurrent-idempotency shape `AP-13` (and the task's own instruction) asks for, not an
 * extra de-duplication layer bolted on afterward.
 *
 * Returns the **lower** threshold first when both are simultaneously due (e.g. a scan
 * delayed past the 90% mark on an approval that never received a 50% reminder) — `reminder-scan`'s
 * own 15-minute cadence (`docs/01-architecture/background-jobs.md`) then catches the 90%
 * reminder on its very next run, once this call's caller has persisted
 * `reminder_50_sent_at`. Neither reminder is ever considered due for a non-`pending`
 * approval: an `expired`, `approved`, `rejected` or `withdrawn` approval has nothing left
 * to remind anyone about.
 *
 * A malformed window (`expiresAt` at or before `createdAt`) has no well-defined 50%/90%
 * instant to compare against `now` — this returns `null` rather than guessing, the same
 * fail-closed-on-malformed-input stance `../workflow/workflow.ts`'s `evaluateGuard` takes
 * for a guard type it does not recognise (report nothing due, rather than a possibly-wrong
 * "due").
 */
export function dueReminder(
  approval: Approval,
  now: Date,
): ReminderKind | null {
  if (approval.state !== "pending") {
    return null;
  }
  const windowMs = approval.expiresAt.getTime() - approval.createdAt.getTime();
  if (windowMs <= 0) {
    return null;
  }
  const elapsedMs = now.getTime() - approval.createdAt.getTime();
  const pct = elapsedMs / windowMs;

  if (approval.reminder50SentAt === null && pct >= 0.5) {
    return "reminder_50";
  }
  if (approval.reminder90SentAt === null && pct >= 0.9) {
    return "reminder_90";
  }
  return null;
}
