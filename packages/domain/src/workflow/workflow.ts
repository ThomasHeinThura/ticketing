/**
 * Workflow transitions — pure functions, no I/O, no ambient clock.
 *
 * Every function here takes the workflow version, the transitions it carries, and
 * every fact it needs as plain arguments. None of them load a `workflow`/`workflow_version`
 * row, query a child work item's state, resolve an approval's decisions, or write an
 * `sla_pause` row — those are the impure edge (`apps/api`), per
 * `docs/03-features/workflows.md` and [ADR 0011](../../../../docs/01-architecture/adr/0011-ticket-lifecycle-engine.md).
 *
 * **A state change is never a plain field update.** Every rule below exists so the
 * legality of a transition — who may make it, from where, blocked by what — is decided
 * in one place and cannot be bypassed by a `PATCH`.
 *
 * **A state has two levels** (`data-model.md` §3): a workspace-level `state_template`
 * (carries `group`) and a project's own concrete `state` (carries no `group` of its own —
 * a concrete state's group is its template's). Transitions reference templates only, so
 * legality below is decided entirely at the template level; resolving a template to a
 * project's own concrete row is the separate, later step `resolveStateTemplateForProject`
 * performs.
 */

import type {
  BlockReason,
  ChangeRiskLevel,
  Effect,
  Guard,
  GuardContext,
  GuardResult,
  ProjectStateAdoption,
  ProjectStateValidationResult,
  StateGroup,
  StateTemplateId,
  StateTemplateResolution,
  TransitionOffer,
  TransitionOfferContext,
  Workflow,
  WorkflowState,
  WorkflowTransition,
  WorkflowValidationResult,
  WorkflowVersion,
} from "./types.js";
import { CHANGE_RISK_LEVELS } from "./types.js";

// ---------------------------------------------------------------------------
// State groups — ADR 0011's fixed vocabulary. "Closed" means `group` is `completed` or
// `cancelled`; "open" means anything else — never a state name (`WF-15`). `group` always
// arrives here already resolved to a `state_template`'s own value (`WorkflowState.group`)
// — a project's concrete `state` carries no `group` column for this function to read.
// ---------------------------------------------------------------------------

const CLOSED_GROUPS: ReadonlySet<StateGroup> = new Set([
  "completed",
  "cancelled",
]);

/** `WF-15`'s own definition of "closed", as reusable code rather than restated prose each call site. */
export function isClosedGroup(group: StateGroup): boolean {
  return CLOSED_GROUPS.has(group);
}

// ---------------------------------------------------------------------------
// Legality — WF-2, WF-3, WF-4, WF-5. Decided entirely at the state-**template** level:
// a transition's `fromStateTemplateId`/`toStateTemplateId` are templates, and so is
// `currentStateTemplateId`/`targetStateTemplateId` below — the work item's current
// concrete state, resolved by the caller to its own template via
// `state.state_template_id` before it ever reaches this function ("How a transition
// resolves to a project's state", `workflows.md`).
// ---------------------------------------------------------------------------

/**
 * Whether `transition` may be taken from `currentStateTemplateId` by an actor holding
 * `actorRoleIds`.
 */
function isLegalFor(
  transition: WorkflowTransition,
  currentStateTemplateId: StateTemplateId,
  actorRoleIds: readonly string[],
): boolean {
  const fromMatches =
    transition.fromStateTemplateId === null ||
    transition.fromStateTemplateId === currentStateTemplateId;
  const roleMatches =
    transition.roleId === null || actorRoleIds.includes(transition.roleId);
  return fromMatches && roleMatches;
}

/**
 * Every transition legal from `currentStateTemplateId` for an actor holding any of
 * `actorRoleIds` — the union-of-roles rule (`WF-3`/`WF-4`/`WF-5`): a `null` `roleId`
 * matches every actor, and a `null` `fromStateTemplateId` matches every current state
 * template (used for Cancel). Returns `[]` rather than throwing when nothing matches —
 * the caller (which knows whether the actor held `work_item:transition` at all) decides
 * between 403 and 409 (`WF-4`); this function only ever answers "not from here", never
 * "you may not".
 */
export function legalTransitions(
  transitions: readonly WorkflowTransition[],
  currentStateTemplateId: StateTemplateId,
  actorRoleIds: readonly string[],
): WorkflowTransition[] {
  return transitions.filter((t) =>
    isLegalFor(t, currentStateTemplateId, actorRoleIds),
  );
}

/**
 * The one transition (if any) matching `(currentStateTemplateId, targetStateTemplateId,
 * one of actorRoleIds)` exactly — `WF-4`'s own phrasing. `undefined` means the transition
 * is illegal: not from here, not for this actor, or both. The caller returns 409 with the
 * reason; this function never decides which HTTP status applies.
 */
export function findLegalTransition(
  transitions: readonly WorkflowTransition[],
  currentStateTemplateId: StateTemplateId,
  targetStateTemplateId: StateTemplateId,
  actorRoleIds: readonly string[],
): WorkflowTransition | undefined {
  return legalTransitions(
    transitions,
    currentStateTemplateId,
    actorRoleIds,
  ).find((t) => t.toStateTemplateId === targetStateTemplateId);
}

/**
 * Filters out transitions requiring a CAB that are not offered on this work item's
 * type (`WF-14`): "Only offered on types with `work_item_type.is_change = true` —
 * never matched by a type's name." `isChangeType` is the caller-resolved boolean; this
 * function never inspects a type's name or key.
 */
export function filterOfferableForType(
  transitions: readonly WorkflowTransition[],
  isChangeType: boolean,
): WorkflowTransition[] {
  if (isChangeType) {
    return [...transitions];
  }
  return transitions.filter((t) => !t.requiresCab);
}

// ---------------------------------------------------------------------------
// Resolution — "Resolving a transition to a project's state" (workflows.md, WF-2),
// reused verbatim for schedule_transition's own to_state_template_id (WF-19).
// ---------------------------------------------------------------------------

/**
 * Resolves one `state_template.id` to `adoptedStates`' concrete `state.id` for this
 * project — the pure half of "Resolving a transition to a project's state" (`workflows.md`
 * `WF-2`). Legality itself is decided purely at the template level, above, by comparing
 * the work item's current template against `fromStateTemplateId`; only the *target* of an
 * already-legal transition — its `toStateTemplateId` — is ever resolved to a concrete
 * row, because that concrete row is what `work_item.state_id` must become. The identical
 * resolution is reused, unchanged, for `schedule_transition`'s own `toStateTemplateId`
 * (`WF-19`) — pass `effect.toStateTemplateId` instead of `transition.toStateTemplateId`
 * and the same function answers both; this module does not duplicate the lookup.
 *
 * The interesting outcome is the failure, not the success: a workflow attached to a work
 * item type is shared by every project that uses it, and a project that has not yet
 * created a concrete `state` for the transition's target template is not a bug — it is
 * WF-2's own "if no such row exists, the transition is not available in this project"
 * (filtered out of `GET /transitions`; a stale attempt refused with the same 409 as "no
 * matching transition", `WF-4`). So this returns a named result, never an exception and
 * never a bare `undefined` a caller could forget to check — the same style `evaluateGuard`
 * uses for `GuardResult`, below.
 */
export function resolveStateTemplateForProject(
  stateTemplateId: StateTemplateId,
  adoptedStates: ProjectStateAdoption,
): StateTemplateResolution {
  const stateId = adoptedStates.get(stateTemplateId);
  if (stateId === undefined) {
    return {
      ok: false,
      reason: "template_not_adopted",
      stateTemplateId,
    };
  }
  return { ok: true, stateId };
}

// ---------------------------------------------------------------------------
// Guards — WF-15, WF-16.
// ---------------------------------------------------------------------------

// Derived from CHANGE_RISK_LEVELS' own order — a single source of truth for the
// ranking, rather than a second hand-written low/medium/high list that could drift.
const RISK_RANK = Object.fromEntries(
  CHANGE_RISK_LEVELS.map((level, index) => [level, index]),
) as Record<ChangeRiskLevel, number>;

/** Whether a required field's value counts as present. `undefined`, `null` and `""` do not. */
function isFieldPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Evaluates one guard against caller-resolved facts (`WF-15`). Never queries anything
 * itself — `context` is assumed already resolved. A blocked guard returns a stable
 * `guard.<type>` reason code (`WF-16`), never a free-text message, so the caller (and
 * this module's own tests) can distinguish *which* guard failed without parsing prose.
 */
export function evaluateGuard(
  guard: Guard,
  context: GuardContext,
): GuardResult {
  const blocked = (): GuardResult => ({
    guard,
    ok: false,
    reasonCode: `guard.${guard.type}`,
  });
  const satisfied = (): GuardResult => ({ guard, ok: true, reasonCode: null });

  switch (guard.type) {
    case "children_closed":
      return context.allChildrenClosed ? satisfied() : blocked();
    case "no_open_blockers":
      return context.hasOpenBlockers ? blocked() : satisfied();
    case "assignee_present":
      return context.assigneePresent ? satisfied() : blocked();
    case "field_required":
      return isFieldPresent(context.fieldValues[guard.field])
        ? satisfied()
        : blocked();
    case "change_risk_at_most": {
      // No risk value at all (never a change, or not yet set) cannot be confirmed "at
      // most" anything — fails closed rather than assuming the lowest risk.
      if (context.changeRiskLevel === null) {
        return blocked();
      }
      return RISK_RANK[context.changeRiskLevel] <= RISK_RANK[guard.level]
        ? satisfied()
        : blocked();
    }
    default:
      // A guard type the union does not know about. NOT unreachable: guards live in a
      // `jsonb` column, so this union constrains callers of this module and nothing
      // else — a later migration, a hand-edited row, or a rolled-back deployment can
      // all put an unknown `type` here.
      //
      // Before this branch existed the switch fell through, returned `undefined`, and
      // `offerTransition` died on `TypeError: Cannot read properties of undefined
      // (reading 'ok')`. That happened to block the transition, but only by crashing —
      // and the safety depended on the ABSENCE of a null check. The next person to
      // "fix the crash" with `r?.ok` would have turned it into a silent pass, which is
      // an authorization hole wearing the costume of a null-safety fix.
      //
      // So: fail closed, with a reason code of its own. An unknown guard is never
      // satisfied, and the operator can tell "malformed workflow row" apart from
      // "server bug".
      return { guard, ok: false, reasonCode: "guard.unrecognized" };
  }
}

/** Evaluates every guard on a transition, preserving order. Includes satisfied guards too — callers filter with `.filter(r => !r.ok)`. */
export function evaluateGuards(
  guards: readonly Guard[],
  context: GuardContext,
): GuardResult[] {
  return guards.map((g) => evaluateGuard(g, context));
}

// ---------------------------------------------------------------------------
// Notes — WF-10, WF-11.
// ---------------------------------------------------------------------------

/** Whether `transition`'s note policy blocks completion given whether a note was supplied (`WF-10`). */
export function noteBlocked(
  transition: WorkflowTransition,
  hasNote: boolean,
): boolean {
  return transition.notePolicy === "required" && !hasNote;
}

// ---------------------------------------------------------------------------
// Offering — combines guards, approval, CAB and note gates into one "why is this
// blocked" answer for the state select (`workflows.md` § "The state select").
// ---------------------------------------------------------------------------

/**
 * Whether an already role/state-template-legal transition is available right now, and if
 * not, every distinguishable reason it is blocked. Role and CAB-type-gate exclusions
 * (`WF-14`) are decided earlier, by `legalTransitions`/`filterOfferableForType` — a
 * transition that fails either of those is *absent*, never passed to this function
 * ("The state select": illegal transitions are not shown at all, only blocked ones are
 * shown disabled with a reason).
 */
export function offerTransition(
  transition: WorkflowTransition,
  context: TransitionOfferContext,
): TransitionOffer {
  const blockedBy: BlockReason[] = [];

  for (const result of evaluateGuards(transition.guards, context)) {
    if (!result.ok && result.reasonCode) {
      blockedBy.push({ kind: "guard", reasonCode: result.reasonCode });
    }
  }
  if (transition.requiresApproval && !context.approvalSatisfied) {
    blockedBy.push({ kind: "approval", reasonCode: "approval.pending" });
  }
  if (transition.requiresCab && !context.cabSatisfied) {
    blockedBy.push({ kind: "cab", reasonCode: "cab.pending" });
  }
  if (noteBlocked(transition, context.hasNote)) {
    blockedBy.push({ kind: "note", reasonCode: "note.required" });
  }

  return { transition, available: blockedBy.length === 0, blockedBy };
}

// ---------------------------------------------------------------------------
// Effects — WF-17, WF-18, WF-19. Named, never executed.
// ---------------------------------------------------------------------------

/**
 * The ordered list of effects a transition carries, exactly as `workflow_transition.effects`
 * defines them (`WF-19`). This is the *only* seam that reads the effects vocabulary —
 * every executor (`apps/api`) imports this instead of touching `transition.effects`
 * directly. It never executes an effect: writing the `sla_pause` row a `pause_sla`
 * instruction implies, resolving `'default'` for `set_assignee`, computing
 * `due_at = now() + afterMinutes` for `schedule_transition`, and resolving that effect's
 * own `toStateTemplateId` against the work item's project (`resolveStateTemplateForProject`,
 * above) are all the caller's job — this function does not thread a clock, or a project's
 * adopted states, through at all, deliberately (see the P2 plan's `now`-shape note for
 * `#31`: `schedule_transition`'s absolute `due_at` is one-line arithmetic done where the
 * row is written, not inside the pure core).
 */
export function resolveEffects(transition: WorkflowTransition): Effect[] {
  return [...transition.effects];
}

// ---------------------------------------------------------------------------
// Reopen — WF-21.
// ---------------------------------------------------------------------------

/**
 * The version's reopen transition, if it has one (`WF-21`, at most one per version —
 * enforced structurally by `validateWorkflowVersion` too, not only the database's
 * partial unique index). `null` means: the customer-initiated reopen action (a reply to
 * a closed request, an upload to a resolved one, `customer-portal.md` `CP-8`) is
 * accepted, the item stays resolved, and a flagged activity row asks staff to look — the
 * caller's job, not this function's.
 */
export function findReopenTransition(
  transitions: readonly WorkflowTransition[],
): WorkflowTransition | null {
  return transitions.find((t) => t.isReopen) ?? null;
}

// ---------------------------------------------------------------------------
// Version selection — WF-6, WF-7, WF-8.
// ---------------------------------------------------------------------------

/**
 * The workflow's currently active version, if any (`WF-7`). A workflow with no active
 * version yet (a brand-new workflow with only a draft) returns `undefined` — never a
 * guess at "the first" or "the newest" version, since publishing is what makes a version
 * active and nothing else does (`WF-6`).
 */
export function selectActiveVersion(
  workflow: Workflow,
  versions: readonly WorkflowVersion[],
): WorkflowVersion | undefined {
  if (workflow.activeVersionId === null) {
    return undefined;
  }
  return versions.find((v) => v.id === workflow.activeVersionId);
}

// ---------------------------------------------------------------------------
// Structural analysis — the validation panel's pure core (`workflows.md` § Screens,
// "Workflow editor"). These *report*; they do not refuse. WF-2's actual refusal is
// `validateProjectStateSelection`, below. Every id here is a `state_template.id`: a
// workflow's transitions connect templates, never a project's concrete `state` rows, so
// "the graph" this section reasons about is always the template graph.
// ---------------------------------------------------------------------------

/**
 * State templates with no way out at all: no transition has `fromStateTemplateId` equal
 * to the template, and no transition has `fromStateTemplateId: null` (an "any state
 * template" transition, which — because it can be taken from any current template —
 * counts as an outbound path for every template, including this one). A template
 * reported here is a genuine dead end: nothing (`WF-9`'s "stuck") ever leaves it,
 * terminal by data, never by a hardcoded template name.
 */
export function noOutboundStateIds(
  states: readonly WorkflowState[],
  transitions: readonly WorkflowTransition[],
): StateTemplateId[] {
  const hasAnyStateTransition = transitions.some(
    (t) => t.fromStateTemplateId === null,
  );
  if (hasAnyStateTransition) {
    return [];
  }
  const withOutbound = new Set(
    transitions
      .map((t) => t.fromStateTemplateId)
      .filter((id): id is StateTemplateId => id !== null),
  );
  return states.filter((s) => !withOutbound.has(s.id)).map((s) => s.id);
}

/**
 * State templates nothing ever transitions into, starting the search from
 * `initialStateIds` (the template(s) realised by the project's own default concrete
 * state — `state.is_default`, `data-model.md` §3; the retired `project_state` table this
 * once lived on is gone). A workflow version carries no "initial state" of its own — see
 * `validateProjectStateSelection`. An `fromStateTemplateId: null` transition can be taken
 * the moment *any* template is reachable, so its `toStateTemplateId` becomes reachable as
 * soon as the reachable set is non-empty — not only from a specific origin.
 */
export function unreachableStates(
  states: readonly WorkflowState[],
  transitions: readonly WorkflowTransition[],
  initialStateIds: readonly StateTemplateId[],
): StateTemplateId[] {
  const reachable = new Set<StateTemplateId>(initialStateIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of transitions) {
      if (reachable.has(t.toStateTemplateId)) {
        continue;
      }
      const reachableFromHere =
        t.fromStateTemplateId === null
          ? reachable.size > 0
          : reachable.has(t.fromStateTemplateId);
      if (reachableFromHere) {
        reachable.add(t.toStateTemplateId);
        changed = true;
      }
    }
  }
  return states.filter((s) => !reachable.has(s.id)).map((s) => s.id);
}

/**
 * Roles named on at least one transition, or every role at all if any transition has
 * `roleId: null` (which matches every role by definition), have a legal transition
 * somewhere in the version. `roleIds` not covered by either are reported — the
 * validation panel's "roles with no legal transition at all".
 */
export function rolesWithNoLegalTransition(
  transitions: readonly WorkflowTransition[],
  roleIds: readonly string[],
): string[] {
  if (transitions.some((t) => t.roleId === null)) {
    return [];
  }
  const withTransition = new Set(
    transitions.map((t) => t.roleId).filter((id): id is string => id !== null),
  );
  return roleIds.filter((id) => !withTransition.has(id));
}

// ---------------------------------------------------------------------------
// Structural validation — fail-closed checks on malformed input, before any of the
// above is asked to compute anything (mirrors `calendar/`'s `validateCalendar`: a
// version is validated once, at save; the functions above never re-defend against
// malformed input on every call).
// ---------------------------------------------------------------------------

/**
 * Validates a workflow version's shape: every `states` (state template) id is unique,
 * every transition's `fromStateTemplateId`/`toStateTemplateId` names a template that
 * exists, no two transitions share the same `(fromStateTemplateId, toStateTemplateId,
 * roleId)` tuple, and at most one transition is marked `isReopen` (`WF-21`, otherwise
 * enforced only by the database's partial unique index — this catches it before a
 * version is even persisted). A version with no state templates at all is rejected
 * outright: a workflow that can hold no work item is malformed, not merely empty.
 */
export function validateWorkflowVersion(
  states: readonly WorkflowState[],
  transitions: readonly WorkflowTransition[],
): WorkflowValidationResult {
  const errors: string[] = [];

  if (states.length === 0) {
    errors.push("workflow version has no states");
  }

  const stateIds = new Set<StateTemplateId>();
  for (const s of states) {
    if (stateIds.has(s.id)) {
      errors.push(`duplicate state id: ${s.id}`);
    }
    stateIds.add(s.id);
  }

  const seenTuples = new Set<string>();
  let reopenCount = 0;
  for (const t of transitions) {
    if (
      t.fromStateTemplateId !== null &&
      !stateIds.has(t.fromStateTemplateId)
    ) {
      errors.push(
        `transition ${t.id} names a from-state that does not exist: ${t.fromStateTemplateId}`,
      );
    }
    if (!stateIds.has(t.toStateTemplateId)) {
      errors.push(
        `transition ${t.id} names a to-state that does not exist: ${t.toStateTemplateId}`,
      );
    }
    const tuple = `${t.fromStateTemplateId ?? "*"}→${t.toStateTemplateId}·${t.roleId ?? "*"}`;
    if (seenTuples.has(tuple)) {
      errors.push(
        `duplicate transition: ${t.fromStateTemplateId ?? "(any)"} → ${t.toStateTemplateId} for role ${t.roleId ?? "(any)"}`,
      );
    }
    seenTuples.add(tuple);
    if (t.isReopen) {
      reopenCount++;
    }
  }
  if (reopenCount > 1) {
    errors.push(
      `workflow version has ${reopenCount} reopen transitions; at most one is allowed`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * `WF-2`/`WF-9`: "A project may not create a concrete state for a template with no
 * outbound transition anywhere in the workflows its types use; the validation panel
 * refuses it." `enabledStateIds`/`defaultStateId` are `state_template.id`s — the
 * templates this project has adopted, or is choosing to adopt — never a project's
 * concrete `state.id`s directly; see `ProjectStateValidationResult`'s own doc comment for
 * why this function reasons at the template level. `defaultStateId` is the template
 * realised by the project's default concrete state (`state.is_default`, replacing the
 * retired `project_state.is_default`) — a workflow version has no "initial state" field
 * of its own, so a project with no default selected at all (`defaultStateId: null`) is
 * itself refused: work items need somewhere to start. Assumes `transitions` is already
 * structurally valid (`validateWorkflowVersion`); this function fails closed on the
 * project-state-selection question only, not on a malformed version.
 */
export function validateProjectStateSelection(
  transitions: readonly WorkflowTransition[],
  enabledStateIds: readonly StateTemplateId[],
  defaultStateId: StateTemplateId | null,
): ProjectStateValidationResult {
  const errors: string[] = [];

  if (defaultStateId === null) {
    errors.push("no default state selected");
  } else if (!enabledStateIds.includes(defaultStateId)) {
    errors.push(
      `default state ${defaultStateId} is not one of the project's enabled states`,
    );
  }

  const withOutbound = new Set(
    transitions
      .map((t) => t.fromStateTemplateId)
      .filter((id): id is StateTemplateId => id !== null),
  );
  const hasAnyStateTransition = transitions.some(
    (t) => t.fromStateTemplateId === null,
  );
  const refusedStateIds = hasAnyStateTransition
    ? []
    : enabledStateIds.filter((id) => !withOutbound.has(id));

  for (const id of refusedStateIds) {
    errors.push(`state ${id} has no outbound transition in this workflow`);
  }

  return { valid: errors.length === 0, refusedStateIds, errors };
}
