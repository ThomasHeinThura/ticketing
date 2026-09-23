/**
 * Intake — the submission state machine and reference format.
 *
 * The one implementation of `intake-queue.md`'s behaviour rules (IQ-2, IQ-6, IQ-13,
 * IQ-15, IQ-16, IQ-16a, IQ-17), used by the portal submission route, the intake API and
 * (later) the queue UI — never duplicated in a caller. Pure: no I/O, no clock, no
 * sequence. Every result is a discriminated union, never a thrown error — an illegal
 * transition is a caller-visible outcome, not a crash.
 *
 * What is deliberately NOT here (storage/API concerns, recorded so they are not
 * forgotten): the instance-wide `SUB-n` sequence, optimistic concurrency (the 409 on
 * simultaneous accept/withdraw — intake-queue.md § Edge cases), the accept-time
 * attachment/thread transfer (IQ-9/IQ-10, atomic or rolled back), and the watcher add
 * on duplicate merge (IQ-17) — this module only answers whether the transition may
 * happen.
 */

import type {
  SubmissionActor,
  SubmissionRecord,
  SubmissionState,
} from "./types.js";

/** A refused transition: the exact rule that refused it, for a precise caller message. */
export type TransitionRefusal =
  | "illegal_state"
  | "not_your_action"
  | "triage_started"
  | "missing_reason"
  | "missing_target"
  | "missing_work_item";

export type TransitionResult =
  | {
      readonly ok: true;
      readonly to: SubmissionState;
      readonly record: SubmissionRecord;
    }
  | { readonly ok: false; readonly refusal: TransitionRefusal };

/** The actions IQ-6 names, plus the customer-side paths the spec gives them. */
export type SubmissionAction =
  | "clarify" // IQ-6, staff
  | "reply" // IQ-13, customer
  | "accept" // IQ-6/IQ-7, staff
  | "decline" // IQ-16, staff (reason mandatory, verbatim to the customer)
  | "auto_decline" // IQ-15, the system (clarifying overdue)
  | "duplicate" // IQ-6/IQ-17, staff
  | "withdraw" // IQ-16a, customer
  | "reopen"; // IQ-15 ("the customer may reopen it")

export type TransitionInput = {
  readonly action: SubmissionAction;
  readonly actor: SubmissionActor;
  readonly now: Date;
  /** Required for `decline`/`auto_decline` (IQ-16: no silent decline). */
  readonly reason?: string;
  /** Required for `duplicate` (IQ-17: the work item it merges into). */
  readonly targetWorkItemId?: string;
  /** Required for `accept` (IQ-7's chosen project's item, created by the caller). */
  readonly workItemId?: string;
  /** IQ-15's configurable clarifying ceiling, default 14 days. */
  readonly clarifyingMaxDays?: number;
};

const DEFAULT_CLARIFYING_MAX_DAYS = 14;

/**
 * Whether a `clarifying` submission has passed IQ-15's ceiling. The clock is
 * `clarifyingSince` → `now`; no pause semantics here (the spec grants none).
 */
export function isClarificationOverdue(
  record: SubmissionRecord,
  now: Date,
  maxDays: number = DEFAULT_CLARIFYING_MAX_DAYS,
): boolean {
  if (record.state !== "clarifying" || record.clarifyingSince === null) {
    return false;
  }
  return (
    now.getTime() - record.clarifyingSince.getTime() > maxDays * 86_400_000
  );
}

/**
 * Whether a triager has "taken any action" (IQ-16a): a queue claim, a staff message,
 * or starting acceptance. Once true, the customer can no longer withdraw.
 */
export function triageHasStarted(record: SubmissionRecord): boolean {
  return (
    record.claimedAt !== null ||
    record.claimedBy !== null ||
    record.staffMessageCount > 0
  );
}

/**
 * The state machine. Legal source states per action, then the action's own guards:
 *
 * - `clarify`: staff only, from `new` or `clarifying` → `clarifying`.
 * - `reply`: customer only, from `clarifying` → `new` (IQ-13: status returns to new).
 * - `accept`: staff only, from `new` or `clarifying` → `accepted`; the caller must
 *   supply the work item it created (IQ-7/IQ-8's conversion). Concurrency (second
 *   triager gets 409) is the storage layer's, per § Edge cases.
 * - `decline`: staff only, from `new` or `clarifying` → `declined`; reason required
 *   and non-blank (IQ-16, "there is no silent decline").
 * - `auto_decline`: the system path (IQ-15) — same targets as `decline`, requires the
 *   submission actually be overdue (a caller-supplied `now` against `clarifyingSince`).
 * - `duplicate`: staff only, from `new` or `clarifying` → `duplicate`; target work item
 *   id required (IQ-17's link).
 * - `withdraw`: customer only, from `new` or `clarifying` → `withdrawn`, refused once
 *   triage has started (IQ-16a). Retained, never deleted.
 * - `reopen`: customer only, from `declined` → `new` (IQ-15: "the customer may reopen
 *   it"). The spec stores no auto-vs-staff decline distinction, so this accepts any
 *   `declined` submission — flagged in the PR body as the only implementable reading.
 *
 * Terminal states (`accepted`, `duplicate`, `withdrawn`) accept no actions: the
 * submission has been disposed of, and nothing in either spec reopens them.
 */
export function transitionSubmission(
  record: SubmissionRecord,
  input: TransitionInput,
): TransitionResult {
  const { action, actor } = input;

  const refuse = (refusal: TransitionRefusal): TransitionResult => ({
    ok: false,
    refusal,
  });

  const staffActions: readonly SubmissionAction[] = [
    "clarify",
    "accept",
    "decline",
    "auto_decline",
    "duplicate",
  ];
  if (staffActions.includes(action) && actor !== "triager") {
    return refuse("not_your_action");
  }
  const customerActions: readonly SubmissionAction[] = [
    "reply",
    "withdraw",
    "reopen",
  ];
  if (customerActions.includes(action) && actor !== "customer") {
    return refuse("not_your_action");
  }

  const from = record.state;
  const advance = (to: SubmissionState): TransitionResult => ({
    ok: true,
    to,
    record: { ...record, state: to },
  });

  switch (action) {
    case "clarify": {
      if (from !== "new" && from !== "clarifying")
        return refuse("illegal_state");
      return {
        ok: true,
        to: "clarifying",
        record: { ...record, state: "clarifying", clarifyingSince: input.now },
      };
    }
    case "reply": {
      if (from !== "clarifying") return refuse("illegal_state");
      // IQ-13: status returns to `new`; the clarifying clock is spent.
      return {
        ok: true,
        to: "new",
        record: { ...record, state: "new", clarifyingSince: null },
      };
    }
    case "accept": {
      if (from !== "new" && from !== "clarifying")
        return refuse("illegal_state");
      if (input.workItemId === undefined || input.workItemId === "") {
        return refuse("missing_work_item");
      }
      return advance("accepted");
    }
    case "decline": {
      if (from !== "new" && from !== "clarifying")
        return refuse("illegal_state");
      if (input.reason === undefined || input.reason.trim() === "") {
        return refuse("missing_reason");
      }
      return advance("declined");
    }
    case "auto_decline": {
      if (from !== "clarifying") return refuse("illegal_state");
      if (!isClarificationOverdue(record, input.now, input.clarifyingMaxDays)) {
        return refuse("illegal_state");
      }
      if (input.reason === undefined || input.reason.trim() === "") {
        return refuse("missing_reason");
      }
      return advance("declined");
    }
    case "duplicate": {
      if (from !== "new" && from !== "clarifying")
        return refuse("illegal_state");
      if (
        input.targetWorkItemId === undefined ||
        input.targetWorkItemId === ""
      ) {
        return refuse("missing_target");
      }
      return advance("duplicate");
    }
    case "withdraw": {
      if (from !== "new" && from !== "clarifying")
        return refuse("illegal_state");
      if (triageHasStarted(record)) return refuse("triage_started");
      return advance("withdrawn");
    }
    case "reopen": {
      if (from !== "declined") return refuse("illegal_state");
      return advance("new");
    }
  }
}

/**
 * The instance-wide reference rendered to the customer (IQ-2: `SUB-n`, unique per
 * instance, never reused). The number comes from the sequence; this only formats and
 * parses it, so every surface renders identically.
 */
export function formatSubmissionReference(number: number): string {
  if (!Number.isInteger(number) || number <= 0) {
    throw new RangeError(
      `formatSubmissionReference: ${number} is not a positive integer`,
    );
  }
  return `SUB-${number}`;
}

/** Parses `SUB-n`; returns the number, or `null` when the reference is malformed. */
export function parseSubmissionReference(ref: string): number | null {
  const match = /^SUB-([1-9][0-9]*)$/.exec(ref);
  if (match === null) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}
