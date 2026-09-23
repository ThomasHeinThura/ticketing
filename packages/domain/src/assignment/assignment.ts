/**
 * Assignment — pure functions, no I/O, no ambient clock.
 *
 * Every function here takes plain facts already resolved by the caller (`person.active`,
 * project/team roster membership, the work item's current `assignee_id`) and returns a
 * decision or a plan. None of them query `person`, `team_member` or `work_item`, write an
 * activity row, or send a notification — those are the impure edge (`apps/api`), per
 * `docs/03-features/assignment.md`.
 *
 * **`AS-15` is deliberately not implemented here.** The spec states plainly: "Round-robin
 * and load-balanced assignment are out of scope for v2. They reward gaming and produce
 * worse outcomes than a person looking at a queue." No strategy function — round-robin,
 * least-open-items, or any other automated picker — exists in this module, and none
 * should be added without a spec change first (do-not 17). What *is* built here is the
 * per-person open-work count the person-picker screen displays for a human to read
 * (`assignment.md` § Screens) — a fact, not an algorithm that chooses anyone.
 */

import type { StateGroup } from "../workflow/types.js";
import { isClosedGroup } from "../workflow/workflow.js";
import type {
  AssigneeDisplayFacts,
  AssigneeDisplayStatus,
  AssigneeStanding,
  AssignmentEffect,
  AssignmentPlan,
  ConcurrentAssignResult,
  DefaultAssigneeResolution,
  EligibilityResult,
  PersonId,
  ProjectMoveAssignmentResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Eligibility — AS-5 (project roster, not the whole directory), generalised by the
// default-assignee edge case to require an active person too.
// ---------------------------------------------------------------------------

/**
 * Whether `standing` may be assigned at all: on the **project roster** (`AS-5`'s original
 * rule: "Assigning someone who is not on the project is refused with a suggestion to add
 * them") and active (`AS-5`'s new sentence, added alongside it: "Only active people
 * (`person.active = true`) are eligible for any assignment, direct or default. Assigning
 * to a deactivated person is refused."). Roster membership is checked first: `GET
 * /assignable` (this module's caller) already filters to the roster before a candidate
 * ever reaches here, so a caller reaching this function with someone off the roster is
 * already in the less-common path, and a single, unambiguous reason is what it needs
 * back, not a list.
 */
export function evaluateAssigneeEligibility(
  standing: Pick<AssigneeStanding, "active" | "onRoster">,
): EligibilityResult {
  if (!standing.onRoster) {
    return { eligible: false, reason: "not_on_roster" };
  }
  if (!standing.active) {
    return { eligible: false, reason: "not_active" };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Defaults — AS-11 (project default), AS-12 (request-type default overrides it), and the
// "default assignee is inactive" edge case.
// ---------------------------------------------------------------------------

/**
 * Resolves a work item's default assignee at creation time (`AS-11`/`AS-12`): the request
 * type's default overrides the project's — `AS-12`'s own word, "overriding" — and either
 * may be absent. `isEligible` is the caller's already-resolved
 * `evaluateAssigneeEligibility(...).eligible` for the chosen candidate (never re-derived
 * here); when the chosen default is not eligible, this reports `"default_inactive"`
 * rather than silently falling back to the *other* default — the edge case says the item
 * is "Left unassigned, and the project is flagged in settings," not "try the project's
 * default instead."
 */
export function resolveDefaultAssignee(
  projectDefaultAssigneeId: PersonId | null,
  requestTypeDefaultAssigneeId: PersonId | null,
  isEligible: (personId: PersonId) => boolean,
): DefaultAssigneeResolution {
  const chosen = requestTypeDefaultAssigneeId ?? projectDefaultAssigneeId;
  if (chosen === null) {
    return { assigneeId: null, reason: "no_default" };
  }
  if (!isEligible(chosen)) {
    return { assigneeId: null, reason: "default_inactive" };
  }
  return { assigneeId: chosen };
}

// ---------------------------------------------------------------------------
// Workflow effects — AS-13, reusing `workflow/types.ts`'s own `Effect` vocabulary
// (`AssignmentEffect`, `types.ts`) rather than a second one.
// ---------------------------------------------------------------------------

/**
 * Resolves a `set_assignee`/`clear_assignee` effect (`AS-13`, `workflows.md` `WF-19`) to
 * the assignee a transition's execution should write. `'default'` resolves through
 * `defaultResolution` — the caller's own `resolveDefaultAssignee` result for this work
 * item's project/request type, computed the same way `AS-11`/`AS-12` are — so a
 * transition that sets "default" and an item created with no assignee behave identically
 * when the configured default is inactive: both land on `null`, never a guess at a
 * different candidate. This function only names the resulting assignee; writing
 * `work_item.assignee_id`, the activity row, or a notification is the caller's job.
 */
export function resolveAssignmentEffect(
  effect: AssignmentEffect,
  defaultResolution: DefaultAssigneeResolution,
): PersonId | null {
  if (effect.kind === "clear_assignee") {
    return null;
  }
  if (effect.personId === "default") {
    return defaultResolution.assigneeId;
  }
  return effect.personId;
}

// ---------------------------------------------------------------------------
// Concurrency — the "Two people self-assign simultaneously" edge case.
// ---------------------------------------------------------------------------

/**
 * Decides a compare-and-swap self-assign attempt — the API section's own mechanism:
 * "Conflicts are caught by a conditional write instead: `UPDATE ... WHERE assignee_id IS
 * NULL` (or, for a targeted reassign, `WHERE assignee_id = :expectedCurrentAssigneeId`);
 * zero rows updated means someone else won, and the response is 409 with the row's
 * current `assigneeId`." `expectedCurrentAssigneeId` is what the actor's client believed
 * the assignee was when the conditional write was issued; `actualCurrentAssigneeId` is
 * the row's current `assigneeId`, read by the caller in the same transaction. Equal → the
 * conditional write would have matched a row (`"success"`); unequal → it would have
 * matched zero rows, so "someone else won" and must be named (`"conflict"`) — this
 * function never retries or silently reassigns on the caller's behalf.
 */
export function decideConcurrentSelfAssign(
  expectedCurrentAssigneeId: PersonId | null,
  actualCurrentAssigneeId: PersonId | null,
): ConcurrentAssignResult {
  if (actualCurrentAssigneeId === expectedCurrentAssigneeId) {
    return { outcome: "success" };
  }
  return { outcome: "conflict", winnerId: actualCurrentAssigneeId };
}

// ---------------------------------------------------------------------------
// Planning a change — AS-3, AS-16, AS-17, AS-18, and the already-assigned-to-you no-op.
// ---------------------------------------------------------------------------

/**
 * Decides what happens for one assignment change, and who is notified — `AS-3`, `AS-16`,
 * `AS-17`, `AS-18`, and the edge case "Assigning a work item already assigned to you:
 * No-op, no activity entry, no notification."
 *
 * `newAssigneeId: null` means unassign. `AS-18`'s text: "Assigning yourself does not
 * notify you. `work_item.assigned` still emits (for automations, webhooks and activity)
 * — only the notification fan-out excludes the actor." — and its new sentence: "The
 * actor is never notified of their own action, and this covers unassigning yourself as
 * well as assigning yourself." `notify` excludes `actorId` on both the assign and the
 * unassign path for exactly that reason.
 *
 * **Confirmation is `AS-3`'s own scope, no wider.** `AS-3`: "A member picking up work
 * already held by someone else is asked to confirm, and the previous holder is
 * notified." — "picking up" is a member assigning the work **to themselves**: this is
 * required precisely when there is a previous holder, the new assignee differs from
 * them, AND the new assignee **is the actor** (a self pick-up). A lead or another actor
 * directly reassigning the work from one colleague to another — nobody "picking up"
 * anything themselves — is not the scenario `AS-3` names, so it is not gated on
 * confirmation here; that would be inventing a rule the spec doesn't state (do-not 17).
 * The previous holder is still notified in that case (`AS-17` — being unassigned,
 * implicitly, by the reassignment, still notifies the previous holder), just without
 * requiring the reassigning actor to confirm first.
 */
export function planAssignment(
  currentAssigneeId: PersonId | null,
  newAssigneeId: PersonId | null,
  actorId: PersonId,
): AssignmentPlan {
  if (newAssigneeId === currentAssigneeId) {
    return { action: "noop", requiresConfirmation: false, notify: [] };
  }

  const notify: PersonId[] = [];

  if (newAssigneeId === null) {
    // Unassign: AS-17 notifies the previous holder, unless that is the actor themselves
    // (AS-18's new sentence — "this covers unassigning yourself" — applied here).
    if (currentAssigneeId !== null && currentAssigneeId !== actorId) {
      notify.push(currentAssigneeId);
    }
    return { action: "unassign", requiresConfirmation: false, notify };
  }

  const isReassignment =
    currentAssigneeId !== null && currentAssigneeId !== newAssigneeId;
  // AS-3's "picking up" is the new assignee taking the work over from someone else — the
  // actor and the new assignee must be the same person for this to be a self pick-up.
  const requiresConfirmation = isReassignment && newAssigneeId === actorId;

  if (
    isReassignment &&
    currentAssigneeId !== null &&
    currentAssigneeId !== actorId
  ) {
    notify.push(currentAssigneeId);
  }
  if (newAssigneeId !== actorId) {
    notify.push(newAssigneeId);
  }

  return { action: "assign", requiresConfirmation, notify };
}

// ---------------------------------------------------------------------------
// Retention and display — AS-8, AS-9, AS-10, and the edge cases table.
// ---------------------------------------------------------------------------

/**
 * Resolves how a stored `assignee_id` should be displayed (`AS-7`: "rendered from the
 * directory at read time, so a rename propagates"), given the caller's already-resolved
 * facts about that person. `null` means there is no assignee at all — distinct from every
 * other status, which all mean "there is one, and here is how to show it." Assignment is
 * never silently cleared for any of these reasons (`AS-9`): the caller always has an
 * `assigneeId` to keep displaying, this function only says how.
 *
 * There is no "account deleted"/tombstoned status — `AS-8` states plainly: "People are
 * never hard-deleted — only deactivated (`person.active = false`, `data-model.md`) —
 * and `work_item.assignee_id` is `ON DELETE RESTRICT`, so there is no delete path that
 * could clear or cascade an assignment out from under a work item. 'Departed' means
 * deactivated, never gone." So only three statuses exist. Precedence, most specific
 * first: the edge cases table's "Assignee removed from the project → Assignment
 * retained, shown as '(no longer on this project)'" beats the edge cases table's
 * "Assignee deactivated (`person.active = false`) → Assignment retained, shown as 'Jane
 * Smith (inactive)' — `AS-8`" — a person can be both off this project's roster and
 * deactivated at once, and "not on this project" is the more specific, more actionable
 * fact for the viewer; otherwise active.
 */
export function resolveAssigneeDisplayStatus(
  assigneeId: PersonId | null,
  facts: AssigneeDisplayFacts,
): AssigneeDisplayStatus | null {
  if (assigneeId === null) {
    return null;
  }
  if (!facts.onProject) {
    return "not_on_project";
  }
  if (!facts.active) {
    return "inactive";
  }
  return "active";
}

/**
 * `AS-10`'s report — now marked **P5**, not v2 P1: "**P5.** A report lists work assigned
 * to inactive people, so it can be cleaned up deliberately — see
 * reports-and-dashboards.md. Not a v2 P1 screen; the person-picker's own '(inactive)'
 * rendering (`AS-8`) is what a P1 user sees day to day." Building the *screen* is P5's
 * job, not this PR's; this function is only the pure filter that report will need
 * whenever it is built, kept here now so nothing has to re-derive it later. A thin,
 * generic filter — the caller supplies whatever rows carry an `assigneeId` and its own
 * `isActive` lookup (`person.active`); this function never queries either.
 */
export function workItemsAssignedToInactive<
  T extends { assigneeId: PersonId | null },
>(items: readonly T[], isActive: (personId: PersonId) => boolean): T[] {
  return items.filter(
    (item) => item.assigneeId !== null && !isActive(item.assigneeId),
  );
}

// ---------------------------------------------------------------------------
// Project moves — the "Assigning across projects during a move" edge case.
// ---------------------------------------------------------------------------

/**
 * Resolves what happens to an assignment when a work item moves to another project
 * (edge cases table: "Assignment cleared if the assignee is not on the destination
 * roster; the user is warned first"). This function only decides the outcome; issuing the
 * warning, and obtaining the user's go-ahead, happens before the caller acts on it — the
 * same "decide, then the caller confirms" split `AS-3`'s `requiresConfirmation` uses.
 */
export function resolveAssigneeOnProjectMove(
  currentAssigneeId: PersonId | null,
  destinationRosterIds: ReadonlySet<PersonId>,
): ProjectMoveAssignmentResult {
  if (currentAssigneeId === null) {
    return { assigneeId: null, cleared: false };
  }
  if (destinationRosterIds.has(currentAssigneeId)) {
    return { assigneeId: currentAssigneeId, cleared: false };
  }
  return { assigneeId: null, cleared: true };
}

// ---------------------------------------------------------------------------
// The picker's open-work count — assignment.md § Screens ("current open work count"),
// never a routing strategy (AS-15 — see this module's own doc comment).
// ---------------------------------------------------------------------------

/**
 * How many of `items` are open (`state_template.group not in ('completed', 'cancelled')`,
 * `data-model.md` §4) and assigned to `personId` — the fact the person-picker's "current
 * open work count" displays (`assignment.md` § Screens), reusing `workflow/workflow.js`'s
 * own `isClosedGroup` rather than a second definition of "closed" (do-not 11). This is a
 * read-only count for a human choosing who to assign to next; it is not, and must never
 * become, an input to an automated assignment strategy — `AS-15` rules that out entirely.
 */
export function countOpenAssignments(
  items: readonly { assigneeId: PersonId | null; stateGroup: StateGroup }[],
  personId: PersonId,
): number {
  return items.filter(
    (item) => item.assigneeId === personId && !isClosedGroup(item.stateGroup),
  ).length;
}
