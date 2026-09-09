/**
 * Workflow transitions — pure data types.
 *
 * Mirrors `workflow` / `workflow_version` / `workflow_transition`'s columns
 * (`docs/01-architecture/data-model.md` §6, `docs/03-features/workflows.md`,
 * [ADR 0011](../../../../docs/01-architecture/adr/0011-ticket-lifecycle-engine.md)).
 * `workspace_id`/`key`/`name`/`colour` are database and UI concerns and never appear
 * here — a workflow version is passed into this module as plain data, never loaded by
 * it (do-not 11's tables live in `data-model.md`; this file is the code shape of the
 * `workflow_transition` row and its `guards`/`effects` jsonb, not a second registration
 * of them).
 *
 * **Guard and approval facts are entirely caller-supplied.** `GuardContext` fields
 * (`allChildrenClosed`, `hasOpenBlockers`, ...) are resolved by the impure edge
 * (`apps/api`, querying child work items, blocker relations, the approvals module)
 * before this module ever sees them — nothing here queries a database, and nothing
 * here reads a clock.
 */

/**
 * The five fixed lifecycle groups (ADR 0011). "Closed" means `group` is `completed` or
 * `cancelled`; "open" means anything else — never a state name (`WF-15`).
 */
export const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

export type StateGroup = (typeof STATE_GROUPS)[number];

/** A workspace `state` row, reduced to what this module needs: its identity and group. */
export interface WorkflowState {
  id: string;
  group: StateGroup;
}

/** Whether a transition needs a note before it may complete (`WF-10`). */
export type NotePolicy = "none" | "optional" | "required";

/** Whether a supplied note becomes a public or internal comment (`WF-11`). */
export type NoteVisibility = "public" | "internal";

/** How many raised approvals a gate needs (`WF-13`, shared with `approval/` — #36). */
export type ApprovalPolicy = "any" | "all";

/** The change-risk vocabulary `change_risk_at_most` compares against (`service-management.md` `CH-1`). */
export const CHANGE_RISK_LEVELS = ["low", "medium", "high"] as const;

export type ChangeRiskLevel = (typeof CHANGE_RISK_LEVELS)[number];

/**
 * The five guard types, a closed vocabulary (`WF-15`). `field_required`'s `field` is a
 * native column name, a `cf.<key>` custom-field key, or a satellite key such as
 * `change.rollback_plan` — this module never interprets which; it only asks whether
 * the caller-supplied value map has a present value under that exact key.
 */
export type Guard =
  | { type: "children_closed" }
  | { type: "no_open_blockers" }
  | { type: "assignee_present" }
  | { type: "field_required"; field: string }
  | { type: "change_risk_at_most"; level: ChangeRiskLevel };

export type GuardType = Guard["type"];

/**
 * The lifecycle side-effect vocabulary (`WF-17`/`WF-18`/`WF-19`), the *only* place
 * lifecycle side-effects are defined. This module only names which effects a
 * transition carries (`resolveEffects`) — it never executes one; writing the
 * `sla_pause` row, calling the assignment resolver, or inserting the
 * `scheduled_transition` row are all the impure edge's job.
 */
export type Effect =
  | { kind: "set_assignee"; personId: string | "default" }
  | { kind: "clear_assignee" }
  | { kind: "pause_sla" }
  | { kind: "resume_sla" }
  | { kind: "set_field"; field: string; value: unknown }
  | { kind: "schedule_transition"; afterMinutes: number; toStateId: string };

export type EffectKind = Effect["kind"];

/**
 * A `workflow_transition` row, reduced to what this module needs. `fromStateId: null`
 * means "from any state" (`WF-5`, used for Cancel); `roleId: null` means all roles
 * (`WF-3`). `approvalPolicy` is meaningful only when `requiresApproval` is true.
 */
export interface WorkflowTransition {
  id: string;
  fromStateId: string | null;
  toStateId: string;
  roleId: string | null;
  notePolicy: NotePolicy;
  noteVisibility: NoteVisibility;
  requiresApproval: boolean;
  approvalPolicy: ApprovalPolicy | null;
  requiresCab: boolean;
  isReopen: boolean;
  guards: Guard[];
  effects: Effect[];
}

/** An immutable published (or draft) `workflow_version` row — a set of transitions (`WF-6`). */
export interface WorkflowVersion {
  id: string;
  transitions: WorkflowTransition[];
}

/** A `workflow` row, reduced to the identity a version-selection lookup needs (`WF-7`/`WF-8`). */
export interface Workflow {
  id: string;
  activeVersionId: string | null;
}

/**
 * Facts a guard needs, all resolved by the caller before evaluation (`WF-15`). This
 * module never queries child work items, blocker relations, or the assignee column —
 * it only asks whether the already-resolved facts satisfy the guard.
 */
export interface GuardContext {
  /** `children_closed` — every child work item's state is in the `completed`/`cancelled` group. */
  allChildrenClosed: boolean;
  /** `no_open_blockers` — true if at least one blocking relation is still open. */
  hasOpenBlockers: boolean;
  /** `assignee_present` — the work item currently has an assignee. */
  assigneePresent: boolean;
  /** `field_required` — keyed exactly as the guard's `field` string; a native, `cf.<key>` or satellite key. */
  fieldValues: Record<string, unknown>;
  /** `change_risk_at_most` — `null` when the item carries no change-risk value at all (never a change, or not yet set). */
  changeRiskLevel: ChangeRiskLevel | null;
}

/**
 * The result of evaluating one guard. `reasonCode` is `guard.<type>` when blocked
 * (`WF-16`), never a message.
 *
 * `"guard.unrecognized"` is the code for a guard whose `type` is not in the `Guard`
 * union. That is reachable: guards are stored in a `jsonb` column, and TypeScript's
 * exhaustiveness check constrains this module's callers, not the database. A row written
 * by a later migration, by a hand edit, or by a downgrade fails CLOSED with this code
 * rather than being silently skipped.
 */
export interface GuardResult {
  guard: Guard;
  ok: boolean;
  reasonCode: `guard.${GuardType}` | "guard.unrecognized" | null;
}

/**
 * Everything beyond role/state legality and the CAB type-gate (`WF-14`) that decides
 * whether an already-legal transition is available right now. `approvalSatisfied` and
 * `cabSatisfied` are resolved by the approvals module (#36) against `approval.transition_id`
 * (`WF-13`) — this module never folds approval decisions itself.
 */
export interface TransitionOfferContext extends GuardContext {
  /** Whether every approval this transition's gate requires (`requires_approval`) is satisfied. Ignored when `requiresApproval` is false. */
  approvalSatisfied: boolean;
  /** Whether the CAB gate this transition requires (`requires_cab`) is satisfied. Ignored when `requiresCab` is false. */
  cabSatisfied: boolean;
  /** Whether a note has been supplied for this transition attempt. Ignored when `notePolicy` is not `required`. */
  hasNote: boolean;
}

/** One reason an offered transition is currently blocked — a stable code, never a free-text message (`WF-16`). */
export type BlockReason =
  | { kind: "guard"; reasonCode: `guard.${GuardType}` | "guard.unrecognized" }
  | { kind: "approval"; reasonCode: "approval.pending" }
  | { kind: "cab"; reasonCode: "cab.pending" }
  | { kind: "note"; reasonCode: "note.required" };

/** A transition considered for display: legal for this actor, but possibly still blocked (the "state select", `workflows.md`). */
export interface TransitionOffer {
  transition: WorkflowTransition;
  available: boolean;
  blockedBy: BlockReason[];
}

/** The result of validating a workflow version's structural shape before it is used (fail-closed, never a guess). */
export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * The result of checking whether a project may enable a given set of states (`WF-2`).
 * `refusedStateIds` names exactly which of `enabledStateIds` the workflow has no
 * outbound transition from — the validation panel's own list, not a bare boolean.
 */
export interface ProjectStateValidationResult {
  valid: boolean;
  refusedStateIds: string[];
  errors: string[];
}
