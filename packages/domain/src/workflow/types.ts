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
 * **A state has two levels (corrected 2026-09-09, `data-model.md` §3).** `state_template`
 * is the workspace-level lifecycle-position catalogue a workflow's transitions reference
 * (`from_state_template_id`/`to_state_template_id`) — it alone carries the fixed `group`
 * vocabulary. `state` is a project's own concrete lifecycle position, mapped to exactly
 * one template via `state_template_id`; it carries **no `group` column of its own** — a
 * concrete state's group is its template's. `work_item.state_id` always points at a
 * concrete `state`, never at a template. This module reasons about both, deliberately
 * never letting one stand in for the other — see `StateTemplateId`/`StateId` below.
 *
 * **Guard and approval facts are entirely caller-supplied.** `GuardContext` fields
 * (`allChildrenClosed`, `hasOpenBlockers`, ...) are resolved by the impure edge
 * (`apps/api`, querying child work items, blocker relations, the approvals module)
 * before this module ever sees them — nothing here queries a database, and nothing
 * here reads a clock.
 */

/**
 * Two identities this module must never confuse: a workspace's `state_template.id` and a
 * project's own concrete `state.id`. A `workflow_transition` references only the former
 * (`data-model.md` §3: "This is the row a workspace-scoped `workflow`'s transitions
 * reference ... **never** a project's concrete state directly, which is what lets one
 * workflow serve every project that adopts it"); `work_item.state_id` and
 * `scheduled_transition.from_state_id`/`to_state_id` hold only the latter. Both are, at
 * the database, an ordinary `uuid`/`text` primary key — nothing about the *value* tells
 * them apart, so the type system has to.
 *
 * Each is branded with a distinct phantom tag so `tsc` refuses a value of one where the
 * other is required. The brand does not exist at runtime — both are, underneath, plain
 * strings — so it costs nothing, and it proves nothing about *where* a string actually
 * came from, only that it was deliberately promoted through the matching constructor
 * below rather than assigned implicitly. That is a real, if partial, guarantee: a
 * concrete `state.id` read off a row and passed straight into a `StateTemplateId` slot is
 * a compile error, not a runtime surprise three calls later.
 */
export type StateTemplateId = string & { readonly __brand: "StateTemplateId" };
export type StateId = string & { readonly __brand: "StateId" };

/**
 * The one sanctioned way to produce a `StateTemplateId` from a raw string: at the impure
 * edge, once, wherever a `state_template.id` column is read off a row (or in this
 * module's own tests, where a fixture already knows, by construction, that a literal
 * names a template). Everywhere else, a `StateTemplateId` flows through already typed —
 * this is deliberately the *only* place a `string` is coerced into one, so a reviewer
 * auditing "did a concrete state id leak in here" has exactly one call site per source to
 * check, not every function signature in the module.
 */
export function asStateTemplateId(id: string): StateTemplateId {
  return id as StateTemplateId;
}

/** The one sanctioned way to produce a `StateId` from a raw string — see `asStateTemplateId`. */
export function asStateId(id: string): StateId {
  return id as StateId;
}

/**
 * The five fixed lifecycle groups (ADR 0011). "Closed" means `group` is `completed` or
 * `cancelled`; "open" means anything else — never a state name (`WF-15`). `group` lives
 * on `state_template` only; a project's concrete `state` carries no `group` column of its
 * own — its group is whichever group its template has.
 */
export const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

export type StateGroup = (typeof STATE_GROUPS)[number];

/**
 * A `state_template` row, reduced to what this module needs: its identity and group — the
 * workspace-level lifecycle position a workflow's transitions reference (`data-model.md`
 * §3/§6). This is never a project's concrete `state`: that row is project-scoped and
 * carries no `group` of its own (a concrete state's group is its template's, resolved via
 * `state.state_template_id`).
 */
export interface WorkflowState {
  id: StateTemplateId;
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
 * The **authored** lifecycle side-effect vocabulary (`WF-19` only — corrected
 * 2026-09-09: an earlier draft of this comment cited `WF-17`/`WF-18` here too, which was
 * wrong and is exactly what let a pull-request body go on to claim `resolveEffects`
 * implements them when it structurally cannot). These six kinds, and only these, are what
 * a workflow designer may write into `workflow_transition.effects jsonb` — this module
 * only names which of them a transition carries (`resolveEffects`) — it never executes
 * one; writing the `sla_pause` row, calling the assignment resolver, or inserting the
 * `scheduled_transition` row are all the impure edge's job.
 *
 * `schedule_transition`'s `toStateTemplateId` is a **template** reference, exactly like a
 * transition's own `toStateTemplateId` (`WF-19`): the impure edge resolves it,
 * immediately, against the work item's own project — the identical resolution `WF-2`
 * specifies for a transition (`resolveStateTemplateForProject` in `workflow.ts`) — to a
 * concrete `state` row, stored as such in `scheduled_transition.to_state_id` before
 * `reminder-scan` ever fires it. No template lookup happens at fire time.
 *
 * `WF-17`/`WF-18`'s automatic completed-group mechanism is a **separate, never-authored**
 * vocabulary — see `AutomaticEffect`, directly below, and `resolveAutomaticEffects` in
 * `workflow.ts`. It is deliberately not a member of this union: nothing here should let a
 * hand-authored transition claim an effect that this module derives on its own from state
 * groups, whether or not the transition names any effect at all.
 */
export type Effect =
  | { kind: "set_assignee"; personId: string | "default" }
  | { kind: "clear_assignee" }
  | { kind: "pause_sla" }
  | { kind: "resume_sla" }
  | { kind: "set_field"; field: string; value: unknown }
  | {
      kind: "schedule_transition";
      afterMinutes: number;
      toStateTemplateId: StateTemplateId;
    };

export type EffectKind = Effect["kind"];

/**
 * The automatic lifecycle-effect vocabulary `WF-17`/`WF-18` name — a *different* type
 * from `Effect` above, deliberately never a member of it. `Effect` is exactly the six
 * kinds a workflow designer can author into `workflow_transition.effects jsonb` (`WF-19`);
 * an `AutomaticEffect` is never stored there and can never be authored. It is derived
 * purely from which `state_template.group` (`WorkflowState.group`) a transition enters or
 * leaves — computed every time, for every transition, independent of whatever that
 * transition's own `effects` array does or does not contain:
 *
 * - `resolve_sla` — `WF-17`: entering a `completed`-group state from a non-`completed`
 *   one. The impure edge sets `work_item.resolved_at` to the current time and opens an
 *   `sla_pause` row with reason `resolved`, for every metric this item's SLA policy
 *   tracks (`sla.md` `SLA-11`). Neither a clock nor a metric list is threaded through
 *   here, for the same reason `resolveEffects`'s own doc comment gives for
 *   `schedule_transition`'s `due_at`: that work belongs where the row is written, not in
 *   the pure core — and, like `pause_sla`/`resume_sla` above, per-metric fan-out is
 *   already the impure edge's job, not something any `Effect` carries today either.
 * - `reopen_sla` — `WF-18`: leaving a `completed`-group state, having been in one. The
 *   impure edge clears `resolved_at` back to `null` and closes that same `resolved` pause
 *   row, so the clock resumes from where `SLA-9` says it stopped, never from zero.
 *
 * **Deliberately keyed on `completed`, never on `isClosedGroup`'s "closed"
 * (`completed` ∪ `cancelled`, `WF-15`).** `WF-17`/`WF-18` and `SLA-8` ("resolution stops
 * when the work item enters a state in the **completed** group") all name the narrower
 * group specifically: a cancelled item was never resolved, so entering `cancelled` must
 * never set `resolved_at` or open a `resolved` pause. `isClosedGroup` stays exactly what
 * it always was — WF-15's guard-resolution predicate, for a caller building
 * `GuardContext.allChildrenClosed` — and `isCompletedGroup` (`workflow.ts`) is the
 * distinct, narrower predicate this mechanism actually needs.
 */
export type AutomaticEffect = { kind: "resolve_sla" } | { kind: "reopen_sla" };

export type AutomaticEffectKind = AutomaticEffect["kind"];

/**
 * A `workflow_transition` row, reduced to what this module needs. Both state references
 * are **state templates**, never a project's concrete `state` (`data-model.md` §3/§6):
 * `fromStateTemplateId: null` means "from any state template" (`WF-5`, used for Cancel);
 * `toStateTemplateId` is never null. `roleId: null` means all roles (`WF-3`).
 * `approvalPolicy` is meaningful only when `requiresApproval` is true.
 *
 * Legality (`legalTransitions`/`findLegalTransition`, below) is decided entirely at the
 * template level — comparing a work item's current template against
 * `fromStateTemplateId`. Resolving `toStateTemplateId` to *this project's own* concrete
 * `state` row is a separate, later step: `resolveStateTemplateForProject`'s job, not this
 * type's — see "Resolving a transition to a project's state" (`workflows.md`, `WF-2`).
 */
export interface WorkflowTransition {
  id: string;
  fromStateTemplateId: StateTemplateId | null;
  toStateTemplateId: StateTemplateId;
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
  /** `children_closed` — every child work item's concrete state is, via its own template, in the `completed`/`cancelled` group (a concrete state carries no `group` of its own). */
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
 * Everything beyond role/state-template legality and the CAB type-gate (`WF-14`) that
 * decides whether an already-legal transition is available right now. `approvalSatisfied`
 * and `cabSatisfied` are resolved by the approvals module (#36) against
 * `approval.transition_id` (`WF-13`) — this module never folds approval decisions itself.
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
 * The result of checking whether a project may enable a given set of state **templates**
 * (`WF-2`, `WF-9`): "a project may not create a concrete `state` for a template with no
 * outbound transition anywhere in the workflows its types use." The `enabledStateIds`/
 * `defaultStateId` arguments to `validateProjectStateSelection` (`workflow.ts`) are
 * `state_template.id`s — the templates a project has adopted, or is choosing to adopt —
 * never a project's concrete `state.id` directly; each adopted template is realised by
 * exactly one of that project's own concrete `state` rows (`state.state_template_id`,
 * `state.is_default` — replacing the retired `project_state` table, `data-model.md` §3's
 * correction note). This function reasons entirely at the template level, because that is
 * what a workflow's transitions reference; resolving an adopted template to *this
 * project's own* concrete `state.id` is `resolveStateTemplateForProject`'s job, not this
 * one's. `refusedStateIds` names exactly which of `enabledStateIds` the workflow has no
 * outbound transition from — the validation panel's own list, not a bare boolean.
 */
export interface ProjectStateValidationResult {
  valid: boolean;
  refusedStateIds: StateTemplateId[];
  errors: string[];
}

/**
 * A project's own adoption map: which of its concrete `state` rows realises each
 * `state_template` it has adopted, keyed by `state_template_id` (`data-model.md` §3). Built
 * by the caller from that project's `state` rows — this module never queries them. Used by
 * `resolveStateTemplateForProject` (`workflow.ts`) to answer "Resolving a transition to a
 * project's state" (`workflows.md`, `WF-2`), the identical resolution `WF-19` reuses for
 * `schedule_transition`'s own `toStateTemplateId`.
 */
export type ProjectStateAdoption = ReadonlyMap<StateTemplateId, StateId>;

/**
 * The result of resolving one `state_template.id` to a project's own concrete `state.id`
 * ("Resolving a transition to a project's state", `workflows.md`; `WF-2`). The failure
 * case is the interesting one, in the same style as `BlockReason` above: a workflow
 * shared by every project whose work item types use it will routinely meet a project that
 * has not created a concrete `state` for the template a transition targets — WF-2's "if
 * no such row exists, the transition is not available in this project". That is a named
 * outcome for the caller to act on (filter the transition out of `GET /transitions`, or
 * refuse a stale attempt with the same 409 as "no matching transition", `WF-4`), never a
 * thrown exception and never a bare `undefined` a caller could forget to check.
 */
export type StateTemplateResolution =
  | { ok: true; stateId: StateId }
  | {
      ok: false;
      reason: "template_not_adopted";
      stateTemplateId: StateTemplateId;
    };
