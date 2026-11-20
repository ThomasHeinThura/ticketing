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
 * should be added without a spec change first (do-not 17).
 */

import type {
  AssigneeDisplayFacts,
  AssigneeDisplayStatus,
  AssigneeStanding,
  AssignmentPlan,
  EligibilityResult,
  PersonId,
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
