/**
 * Approvals and CAB — pure data types (issue #36).
 *
 * Mirrors `approval`'s column list (`docs/01-architecture/data-model.md` §7:
 * `work_item_id`, `transition_id`, `kind`, `requested_by`, `approver_id`, `state`,
 * `expires_at`, `reminder_50_sent_at`, `reminder_90_sent_at`, `decided_at`,
 * `decision_note`) reduced to what this module's functions actually read, exactly like
 * `../workflow/types.ts` and `../sla/types.ts` reduce their own rows. Database ids beyond
 * `id`/`transitionId` (`work_item_id`, workspace scoping), row loading, capability checks,
 * activity/notification/event emission and audit writes never appear here — those are the
 * impure edge (`apps/api`), per `docs/03-features/approvals.md`.
 *
 * `ApprovalPolicy` (`any`\|`all`) is **not** redefined here — it is
 * `../workflow/types.ts`'s own type, imported, exactly as that file's own doc comment
 * anticipates ("shared with `approval/` — #36"). Two modules independently declaring the
 * same two-value vocabulary is exactly what do-not 11 exists to prevent.
 */

import type { ApprovalPolicy } from "../workflow/types.js";

export type { ApprovalPolicy };

/**
 * The two kinds `approvals.md` § Purpose deliberately distinguishes: who may request,
 * who may decide, and where they surface differ by kind. Conflating them was a v1 defect
 * (`AP-2`, "The v1 defects being prevented").
 */
export type ApprovalKind = "customer" | "cab";

/**
 * The five-value `approval.state` enumeration (`approvals.md` § Concepts,
 * `data-model.md` §7). A decision is final (`AP-10`): only `pending` ever leaves this set
 * for another state — see `isLegalApprovalAction`/`applyApprovalAction`, below.
 */
export type ApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "withdrawn";

/**
 * The four ways a pending approval leaves `pending` (`AP-6` withdraw, `AP-7`/`AP-9`
 * decide as approve or reject, `AP-12` expire). Not a column — `applyApprovalAction`'s own
 * vocabulary for "what happened", kept separate from `ApprovalState` ("what it now is")
 * the same way `workflow/types.ts` keeps `Effect` separate from the state it causes.
 */
export type ApprovalAction = "approve" | "reject" | "withdraw" | "expire";

/**
 * An `approval` row, reduced to what this module's functions need. `id` is kept (unlike
 * some reduced rows elsewhere in this package) because several functions here compare two
 * or more approvals against each other (the concurrent-same-`kind`-different-`transitionId`
 * test `approvals.md` § Testing names) and a caller needs to tell which is which in the
 * result. `workItemId` is **not** included: no function in this module needs it — gate
 * satisfaction is always evaluated over a caller-supplied list already scoped to one work
 * item (exactly how `../workflow/`'s `legalTransitions` is handed transitions already
 * scoped to one version), and nothing here queries or filters by work item.
 */
export interface Approval {
  id: string;
  /** `approval.transition_id` — the gate this approval was raised against (`AP-5`). */
  transitionId: string;
  kind: ApprovalKind;
  /** `approval.requested_by` — who asked (`AP-8`'s self-approval check reads this). */
  requestedBy: string;
  /** `approval.approver_id` — who must decide (`AP-7`). */
  approverId: string;
  state: ApprovalState;
  /** `approval.created_at` — the reminder window's start (`AP-13`). */
  createdAt: Date;
  /** `approval.expires_at` — the reminder window's end, and `AP-12`'s expiry instant. */
  expiresAt: Date;
  /** `approval.reminder_50_sent_at` — null until the 50% reminder has fired. */
  reminder50SentAt: Date | null;
  /** `approval.reminder_90_sent_at` — null until the 90% reminder has fired. */
  reminder90SentAt: Date | null;
}

/**
 * A gate, as `AP-5`/`AP-15`/`AP-16` define it: a workflow transition's own id, the
 * `any`/`all` policy `workflow_transition.approval_policy` carries, and — for a
 * `requires_cab` gate (`AP-16`) — the single `kind` it accepts. `kind: undefined` is
 * `AP-15`'s plain `requires_approval` gate, which counts an approval of either kind.
 */
export interface ApprovalGate {
  transitionId: string;
  policy: ApprovalPolicy;
  /** `AP-16`: `requires_cab` only accepts `kind = 'cab'`. Omit for a plain `requires_approval` gate. */
  kind?: ApprovalKind;
}

/** Why a new approval request is refused, independent of capabilities (`AP-1`, `AP-2`, `AP-4`, edge cases). */
export type ApprovalRequestRefusalReason =
  | "self_approval"
  /** AP-1: a customer approval requires staff standing too — Permissions § "Request a customer approval", "Staff only". */
  | "requester_not_staff"
  | "cab_requires_staff"
  | "cab_requires_change_type"
  | "expiry_not_in_future"
  | "expiry_exceeds_cap";

/** Everything `validateApprovalRequest` needs, all caller-resolved (`approvals.ts`). */
export interface ApprovalRequestInput {
  kind: ApprovalKind;
  requestedBy: string;
  approverId: string;
  /** The instant this approval expires, as already computed by the caller from a duration or a supplied date. */
  expiresAt: Date;
  now: Date;
  /** `AP-1`/`AP-2`: whether the requester holds staff standing. Domain-checked independent of the `approval:request`/`approval:request_cab` capability, mirroring `AP-8`'s own independence. */
  isRequesterStaff: boolean;
  /** `AP-2`: `work_item_type.is_change` — the same flag `WF-14` uses, never matched by type name. */
  isChangeType: boolean;
}

/** Why a decision attempt is refused (`AP-7`, `AP-8`, `AP-9`, and the Permissions table's "Decide a CAB approval" row — CAB-membership is a Permissions-table rule, not `AP-16`, which is the gate's own kind-matching rule; see `ApprovalGate.kind` above). */
export type ApprovalDecisionRefusalReason =
  | "not_pending"
  | "not_named_approver"
  | "self_approval"
  | "not_cab_member"
  | "note_required";

/** Everything `evaluateApprovalDecision` needs. `cabMemberIds` is a caller-supplied membership set — this module never looks membership up (`approvals.md` § Permissions, "Decide a CAB approval"; `rbac.md`). */
export interface ApprovalDecisionInput {
  approval: Approval;
  actingPersonId: string;
  action: "approve" | "reject";
  note: string | null;
  /** Required to evaluate `approval.kind === 'cab'`; ignored for `kind === 'customer'`. */
  cabMemberIds?: ReadonlySet<string>;
}

/** Why a withdrawal is refused (`AP-6`). */
export type ApprovalWithdrawalRefusalReason = "not_pending" | "not_permitted";

/** Everything `evaluateApprovalWithdrawal` needs (`AP-6`: "The requester may withdraw a pending approval," and, per Permissions, an instance admin, audited). */
export interface ApprovalWithdrawalInput {
  approval: Approval;
  actingPersonId: string;
  isInstanceAdmin: boolean;
}

/** `AP-13`'s two reminder thresholds, as a closed vocabulary rather than a bare string. */
export type ReminderKind = "reminder_50" | "reminder_90";
